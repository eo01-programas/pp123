(() => {
    const STORAGE_KEY = LOCAL_STORAGE_KEY;
    const STORAGE_META_KEY = `${STORAGE_KEY}-meta`;
    let memoryRecords = [];

    function cloneRecords(records) {
        return (records || []).map((record) => TintoreriaUtils.defaultRecord(record));
    }

    function loadLocalRecords() {
        if (memoryRecords.length) {
            return cloneRecords(memoryRecords);
        }

        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            const parsed = raw ? JSON.parse(raw) : [];
            const records = Array.isArray(parsed)
                ? parsed.map((record) => TintoreriaUtils.defaultRecord(record))
                : [];
            memoryRecords = cloneRecords(records);
            return records;
        } catch (error) {
            console.error('No se pudo leer el cache local', error);
            return [];
        }
    }

    function saveLocalRecords(records) {
        memoryRecords = cloneRecords(records);

        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
        } catch (error) {
            console.warn('No se pudo guardar el cache local, se usara solo memoria.', error);
            try {
                localStorage.removeItem(STORAGE_KEY);
            } catch (removeError) {
                console.warn('No se pudo limpiar el cache local.', removeError);
            }
        }
    }

    function loadStorageMeta() {
        try {
            const raw = localStorage.getItem(STORAGE_META_KEY);
            const parsed = raw ? JSON.parse(raw) : null;
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
                ? parsed
                : null;
        } catch (error) {
            console.error('No se pudo leer la metadata del cache', error);
            return null;
        }
    }

    function saveStorageMeta(meta = {}) {
        try {
            localStorage.setItem(STORAGE_META_KEY, JSON.stringify(meta));
        } catch (error) {
            console.warn('No se pudo guardar la metadata del cache.', error);
            try {
                localStorage.removeItem(STORAGE_META_KEY);
            } catch (removeError) {
                console.warn('No se pudo limpiar la metadata del cache.', removeError);
            }
        }
    }

    function saveRecordsSnapshot(records, mode) {
        const normalizedRecords = TintoreriaUtils.sortRecords(
            (records || []).map((record) => TintoreriaUtils.defaultRecord(record))
        );

        saveLocalRecords(normalizedRecords);
        saveStorageMeta({
            mode,
            updatedAt: new Date().toISOString(),
            recordCount: normalizedRecords.length
        });
        return normalizedRecords;
    }

    function updateRemoteCache(records) {
        return saveRecordsSnapshot(records, 'remote');
    }

    function updateLocalCache(records) {
        return saveRecordsSnapshot(records, 'local');
    }

    function loadRemoteCachedRecords() {
        const meta = loadStorageMeta();
        if (!meta || meta.mode !== 'remote') {
            return null;
        }

        return {
            success: true,
            source: 'cache',
            cachedAt: meta.updatedAt || '',
            records: TintoreriaUtils.sortRecords(loadLocalRecords())
        };
    }

    function mergeRecordsById(baseRecords, nextRecords) {
        const mergedById = new Map();

        (baseRecords || []).forEach((record) => {
            const normalized = TintoreriaUtils.defaultRecord(record);
            mergedById.set(String(normalized.id_registro || ''), normalized);
        });

        (nextRecords || []).forEach((record) => {
            const normalized = TintoreriaUtils.defaultRecord(record);
            mergedById.set(String(normalized.id_registro || ''), normalized);
        });

        return Array.from(mergedById.values());
    }

    function parseGvizPayload(text) {
        const source = String(text || '').trim();
        const prefix = 'google.visualization.Query.setResponse(';
        const suffix = ');';
        const start = source.indexOf(prefix);

        if (start === -1) {
            throw new Error('La respuesta del Sheet no tiene el formato esperado.');
        }

        const jsonStart = start + prefix.length;
        const jsonEnd = source.lastIndexOf(suffix);
        if (jsonEnd === -1 || jsonEnd <= jsonStart) {
            throw new Error('No se pudo extraer el JSON del Sheet.');
        }

        return JSON.parse(source.slice(jsonStart, jsonEnd));
    }

    function normalizeGvizCell(cell) {
        if (!cell || cell.v === null || cell.v === undefined) {
            return '';
        }

        if (typeof cell.v === 'string' && cell.v.startsWith('Date(')) {
            return String(cell.f || '').trim();
        }

        if (cell.f !== undefined && cell.f !== null && String(cell.f).trim() !== '') {
            return String(cell.f).trim();
        }

        return String(cell.v).trim();
    }

    function buildRecordsFromGvizTable(table) {
        const cols = Array.isArray(table && table.cols) ? table.cols : [];
        const rows = Array.isArray(table && table.rows) ? table.rows : [];
        const headers = cols.map((column) => String(column && column.label ? column.label : '').trim());

        return rows.map((row) => {
            const cells = Array.isArray(row && row.c) ? row.c : [];
            const record = {};

            headers.forEach((header, index) => {
                if (!header) {
                    return;
                }

                const value = normalizeGvizCell(cells[index]);
                if (Object.prototype.hasOwnProperty.call(record, header)) {
                    if (!String(record[header] || '').trim() && String(value || '').trim()) {
                        record[header] = value;
                    }
                    return;
                }

                record[header] = value;
            });

            return TintoreriaUtils.defaultRecord(record);
        });
    }

    async function listRemoteRecords() {
        const url = new URL(`https://docs.google.com/spreadsheets/d/${encodeURIComponent(SHEET_ID)}/gviz/tq`);
        url.searchParams.set('tqx', 'out:json');
        url.searchParams.set('sheet', DATA_SHEET_NAME);

        const response = await fetch(url.toString(), {
            method: 'GET',
            headers: {
                Accept: 'application/json, text/javascript, */*;q=0.1'
            }
        });

        if (!response.ok) {
            throw new Error(`El Sheet respondio con HTTP ${response.status}.`);
        }

        const payload = parseGvizPayload(await response.text());
        if (payload.status !== 'ok') {
            throw new Error('El Sheet no devolvio datos validos.');
        }

        return buildRecordsFromGvizTable(payload.table || {});
    }

    async function postPayloadNoCors(payload) {
        const formData = new URLSearchParams();
        formData.set('payload', JSON.stringify(payload));
        if (payload && payload.action) {
            formData.set('action', String(payload.action));
        }

        await fetch(WEB_APP_URL, {
            method: 'POST',
            mode: 'no-cors',
            body: formData
        });
    }

    function updateLocalRecord(recordId, changes) {
        const current = loadLocalRecords();
        const index = current.findIndex((record) => String(record.id_registro || '').trim() === String(recordId || '').trim());

        if (index === -1) {
            throw new Error('No se encontro el registro a actualizar.');
        }

        current[index] = TintoreriaUtils.defaultRecord({
            ...current[index],
            ...changes
        });

        updateLocalCache(current);
        return current[index];
    }

    function updateLocalRecords(updates) {
        const current = loadLocalRecords();
        const records = [];

        (updates || []).forEach((update) => {
            const recordId = update && update.id_registro ? update.id_registro : '';
            const changes = update && update.changes ? update.changes : {};
            const index = current.findIndex((record) => String(record.id_registro || '').trim() === String(recordId || '').trim());

            if (index === -1) {
                return;
            }

            current[index] = TintoreriaUtils.defaultRecord({
                ...current[index],
                ...changes
            });
            records.push(current[index]);
        });

        updateLocalCache(current);
        return records;
    }

    window.TintoreriaAPI = {
        getCachedRecords() {
            return loadRemoteCachedRecords();
        },

        async listRecords() {
            const records = updateRemoteCache(await listRemoteRecords());
            return {
                success: true,
                source: 'remote',
                records
            };
        },

        async updateRecord(recordId, changes) {
            if (!recordId) {
                throw new Error('El registro no tiene id_registro.');
            }

            if (!TintoreriaUtils.hasConfiguredWebAppUrl()) {
                return {
                    success: true,
                    source: 'local',
                    record: updateLocalRecord(recordId, changes)
                };
            }

            const cached = loadRemoteCachedRecords();
            let optimisticRecord = null;

            if (cached && Array.isArray(cached.records)) {
                const current = cached.records.find((record) => String(record.id_registro || '') === String(recordId));
                optimisticRecord = TintoreriaUtils.defaultRecord({
                    ...(current || {}),
                    id_registro: recordId,
                    ...changes
                });

                updateRemoteCache(mergeRecordsById(cached.records, [optimisticRecord]));
            }

            await postPayloadNoCors({
                action: 'updateRecord',
                id_registro: recordId,
                changes
            });

            return {
                success: true,
                source: 'remote',
                record: optimisticRecord
            };
        },

        async updateRecords(updates) {
            if (!Array.isArray(updates) || updates.length === 0) {
                return {
                    success: true,
                    source: TintoreriaUtils.hasConfiguredWebAppUrl() ? 'remote' : 'local',
                    records: []
                };
            }

            if (!TintoreriaUtils.hasConfiguredWebAppUrl()) {
                return {
                    success: true,
                    source: 'local',
                    records: updateLocalRecords(updates)
                };
            }

            const cached = loadRemoteCachedRecords();
            let optimisticRecords = [];

            if (cached && Array.isArray(cached.records)) {
                optimisticRecords = updates.map((update) => {
                    const recordId = String(update && update.id_registro ? update.id_registro : '');
                    const changes = update && update.changes ? update.changes : {};
                    const current = cached.records.find((record) => String(record.id_registro || '') === recordId);

                    return TintoreriaUtils.defaultRecord({
                        ...(current || {}),
                        id_registro: recordId,
                        ...changes
                    });
                }).filter((record) => String(record.id_registro || '').trim() !== '');

                updateRemoteCache(mergeRecordsById(cached.records, optimisticRecords));
            }

            await postPayloadNoCors({
                action: 'updateRecords',
                updates
            });

            return {
                success: true,
                source: 'remote',
                records: optimisticRecords
            };
        }
    };
})();
