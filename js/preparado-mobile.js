(() => {
    const state = {
        records: [],
        filteredRecords: [],
        currentQuery: '',
        selectedIds: new Set(),
        toastTimer: null,
        syncing: false
    };

    function getElements() {
        return {
            form: document.getElementById('preparado-mobile-search-form'),
            searchInput: document.getElementById('preparado-mobile-search'),
            scanButton: document.getElementById('preparado-mobile-scan-button'),
            syncStatus: document.getElementById('preparado-mobile-sync-status'),
            resultSummary: document.getElementById('preparado-mobile-result-summary'),
            resultList: document.getElementById('preparado-mobile-results'),
            selectAllBtn: document.getElementById('preparado-mobile-select-all'),
            formCard: document.getElementById('preparado-mobile-form-card'),
            selectionSummary: document.getElementById('preparado-mobile-selection-summary'),
            turnoInput: document.getElementById('preparado-mobile-turno'),
            responsableSelect: document.getElementById('preparado-mobile-responsable'),
            equipoInput: document.getElementById('preparado-mobile-equipo'),
            tipoSelect: document.getElementById('preparado-mobile-tipo'),
            observacionesInput: document.getElementById('preparado-mobile-observaciones'),
            inicioBtn: document.getElementById('preparado-mobile-inicio'),
            finBtn: document.getElementById('preparado-mobile-fin'),
            toast: document.getElementById('preparado-mobile-toast')
        };
    }

    function calculateTurno() {
        const hours = new Date().getHours();
        return (hours >= 7 && hours < 19) ? '1T' : '2T';
    }

    // --- Helpers de pases (valores separados por coma) ---

    function parsePassValues(fieldValue) {
        const raw = String(fieldValue || '').trim();
        if (!raw) return [];
        return raw.split(',').map((v) => v.trim());
    }

    function getPassCount(record) {
        return parsePassValues(record.preparado_inicio).filter(Boolean).length;
    }

    function getFinCount(record) {
        return parsePassValues(record.preparado_fin).filter(Boolean).length;
    }

    function hasOpenPass(record) {
        return getPassCount(record) > getFinCount(record);
    }

    function appendPassValue(existing, newValue) {
        const current = String(existing || '').trim();
        return current ? `${current},${newValue}` : newValue;
    }

    // --- Clasificación de tipos ---
    // Tipos parciales: solo doblan, NO completan el preparado (falta el cosido).
    // Cualquier otro tipo (COSIDO, COS-REPROCESO y los combinados/legacy) cierra el preparado.
    const PARTIAL_TIPOS = new Set(['DOBLADO', 'DOB-REPROCESO']);

    function isClosingTipo(tipo) {
        const normalized = String(tipo || '').trim().toUpperCase();
        return normalized !== '' && !PARTIAL_TIPOS.has(normalized);
    }

    // ¿Ya tiene algún pase CERRADO cuyo tipo completa el preparado?
    function hasClosedClosingPass(record) {
        const tipos = parsePassValues(record.preparado_tipo);
        const fines = parsePassValues(record.preparado_fin);
        return tipos.some((tipo, i) => Boolean(fines[i] && fines[i].trim()) && isClosingTipo(tipo));
    }

    // --- Estado visual de la tarjeta ---

    function getStatusInfo(record) {
        if (hasOpenPass(record)) {
            return { label: 'En proceso', pillClass: 'status-in-progress', cardClass: 'record-card-in-progress' };
        }
        const passCount = getPassCount(record);
        const estado = String(record && record.preparado_estado ? record.preparado_estado : '').trim().toUpperCase();
        if (passCount > 0 && estado === 'OK') {
            return { label: 'Terminado', pillClass: 'status-registered', cardClass: '' };
        }
        if (passCount > 0) {
            return { label: `${passCount} pase(s)`, pillClass: 'status-passes', cardClass: '' };
        }
        return { label: 'Pendiente', pillClass: 'status-pending', cardClass: '' };
    }

    // --- Render de pases en la tarjeta ---

    function buildPassesHtml(record) {
        const inicios = parsePassValues(record.preparado_inicio).filter(Boolean);
        if (!inicios.length) return '';

        const fines = parsePassValues(record.preparado_fin);
        const turnos = parsePassValues(record.preparado_turno);
        const responsables = parsePassValues(record.preparado_supervisor);
        const equipos = parsePassValues(record.preparado_equipo);
        const tipos = parsePassValues(record.preparado_tipo);

        const lines = inicios.map((inicio, i) => {
            const fin = fines[i] || '';
            const isOpen = !fin;
            const metaParts = [
                tipos[i] ? TintoreriaUtils.escapeHtml(tipos[i]) : '',
                responsables[i] ? TintoreriaUtils.escapeHtml(responsables[i]) : '',
                equipos[i] ? TintoreriaUtils.escapeHtml(equipos[i]) : '',
                turnos[i] ? TintoreriaUtils.escapeHtml(turnos[i]) : ''
            ].filter(Boolean).join(' · ');

            const timeLabel = fin
                ? `${TintoreriaUtils.escapeHtml(inicio)} → ${TintoreriaUtils.escapeHtml(fin)}`
                : `${TintoreriaUtils.escapeHtml(inicio)} → en curso...`;

            return `
                <div class="pass-line${isOpen ? ' pass-line-open' : ''}">
                    <strong>Pase ${i + 1}${metaParts ? ` — <span class="pass-meta">${metaParts}</span>` : ''}</strong>
                    <span class="pass-time${isOpen ? ' pass-time-open' : ''}">${timeLabel}</span>
                </div>
            `;
        });

        return `<div class="record-passes">${lines.join('')}</div>`;
    }

    // --- Utilidades de estado ---

    function formatRecordTitle(record) {
        return `${record.cliente || 'Sin cliente'} - ${TintoreriaUtils.formatOpPartida(record.op_tela, record.partida)}`;
    }

    function findRecordById(recordId) {
        return state.records.find((r) => String(r.id_registro || '') === String(recordId || '')) || null;
    }

    function setSyncStatus(message, isError = false) {
        const { syncStatus } = getElements();
        if (!syncStatus) return;
        syncStatus.textContent = message;
        syncStatus.style.color = isError ? 'var(--danger-text)' : 'var(--muted)';
    }

    function showToast(message) {
        const { toast } = getElements();
        if (!toast) return;
        toast.textContent = message;
        toast.classList.remove('hidden');
        if (state.toastTimer) clearTimeout(state.toastTimer);
        state.toastTimer = window.setTimeout(() => toast.classList.add('hidden'), 3200);
    }

    function setRecords(records) {
        state.records = TintoreriaUtils.sortRecords(
            (records || []).map((r) => TintoreriaUtils.defaultRecord(r))
        );
    }

    function filterByExactOpPartida(query) {
        const normalizedQuery = TintoreriaUtils.normalizeOpPartidaSearchValue(query);
        if (!normalizedQuery) return [];
        return state.records.filter((r) => {
            const opPartida = TintoreriaUtils.formatOpPartida(r.op_tela, r.partida);
            return TintoreriaUtils.normalizeOpPartidaSearchValue(opPartida) === normalizedQuery;
        });
    }

    function getSelectableVisibleIds() {
        return state.filteredRecords
            .map((r) => String(r.id_registro || ''))
            .filter(Boolean);
    }

    function pruneSelection() {
        const validIds = new Set(getSelectableVisibleIds());
        const next = new Set();
        state.selectedIds.forEach((id) => { if (validIds.has(id)) next.add(id); });
        state.selectedIds = next;
    }

    // --- Render de resultados ---

    function renderResults() {
        const els = getElements();
        if (!els.resultList || !els.resultSummary || !els.formCard || !els.selectAllBtn) return;

        const query = state.currentQuery.trim();

        if (!query) {
            state.filteredRecords = [];
            state.selectedIds.clear();
            els.resultSummary.textContent = 'Ingresa una OP-PTDA para comenzar.';
            els.resultList.innerHTML = '<div class="empty-state">Ingresa una OP-PTDA para ver coincidencias exactas.</div>';
            els.formCard.classList.add('hidden');
            els.selectAllBtn.classList.add('hidden');
            return;
        }

        state.filteredRecords = filterByExactOpPartida(query);
        pruneSelection();

        if (!state.filteredRecords.length) {
            els.resultSummary.textContent = 'No se encontraron filas para esa OP-PTDA.';
            els.resultList.innerHTML = '<div class="empty-state">No se encontraron coincidencias exactas para la OP-PTDA ingresada.</div>';
            els.formCard.classList.add('hidden');
            els.selectAllBtn.classList.add('hidden');
            return;
        }

        const selectableIds = getSelectableVisibleIds();
        const selectedCount = selectableIds.filter((id) => state.selectedIds.has(id)).length;

        els.resultSummary.textContent = '';
        els.selectAllBtn.classList.toggle('hidden', selectableIds.length === 0);
        els.selectAllBtn.textContent =
            selectableIds.length > 0 && selectedCount === selectableIds.length
                ? 'Limpiar seleccion'
                : 'Seleccionar todo';

        els.resultList.innerHTML = state.filteredRecords.map((record) => {
            const recordId = String(record.id_registro || '');
            const checked = state.selectedIds.has(recordId) ? 'checked' : '';
            const status = getStatusInfo(record);
            const selectedClass = !status.disabled && checked ? ' record-card-selected' : '';
            const color = TintoreriaUtils.escapeHtml(TintoreriaUtils.formatColorLabel(record.color || 'Sin color'));
            const article = TintoreriaUtils.escapeHtml(record.articulo || 'Sin articulo');
            const ruta = TintoreriaUtils.escapeHtml(record.ruta || '—');
            const passesHtml = buildPassesHtml(record);

            const selectRow = `<div class="select-row"><label class="checkbox-label"><input type="checkbox" class="preparado-mobile-checkbox" data-record-id="${TintoreriaUtils.escapeHtml(recordId)}" ${checked}>Seleccionar</label></div>`;

            return `
                <article
                    class="record-card record-card-selectable${status.cardClass ? ` ${status.cardClass}` : ''}${selectedClass}"
                    data-record-id="${TintoreriaUtils.escapeHtml(recordId)}"
                >
                    <div class="record-head">
                        <div class="record-title">${TintoreriaUtils.escapeHtml(formatRecordTitle(record))}</div>
                        <span class="status-pill ${status.pillClass}">${TintoreriaUtils.escapeHtml(status.label)}</span>
                    </div>
                    <div class="record-detail-line"><strong>${color}</strong> <span>${article}</span></div>
                    <div class="record-meta">
                        <div class="meta-line"><strong>Kg(crudo):</strong> ${TintoreriaUtils.escapeHtml(record.peso_kg_crudo || '0')} <span class="meta-separator">|</span> <strong>#rollos/cntd:</strong> ${TintoreriaUtils.escapeHtml(record.cantidad_crudo || '0')}</div>
                        <div class="meta-line"><strong>Ruta:</strong> ${ruta}</div>
                    </div>
                    ${passesHtml}
                    ${selectRow}
                </article>
            `;
        }).join('');

        if (els.selectionSummary) els.selectionSummary.textContent = '';
        els.formCard.classList.toggle('hidden', selectedCount === 0);
        populateForm();
        updateActionButtons();
    }

    function lastPassValue(record, fieldName) {
        const values = parsePassValues(record[fieldName]);
        return values.length ? values[values.length - 1] : '';
    }

    function clearFormFields() {
        const els = getElements();
        if (els.responsableSelect) els.responsableSelect.value = '';
        if (els.equipoInput) els.equipoInput.value = '';
        if (els.tipoSelect) els.tipoSelect.value = '';
        if (els.observacionesInput) els.observacionesInput.value = '';
    }

    // Valor común (último del pase) entre varios registros; '' si difieren o no hay ninguno.
    function commonLastPassValue(records, fieldName) {
        const values = records.map((r) => lastPassValue(r, fieldName));
        const unique = Array.from(new Set(values));
        return unique.length === 1 ? unique[0] : '';
    }

    function populateForm() {
        const els = getElements();
        const openRecords = Array.from(state.selectedIds)
            .map((id) => findRecordById(id))
            .filter((r) => r && hasOpenPass(r));

        // Pre-cargamos con el valor común de los registros con pase abierto.
        // Si son varios y comparten los datos (mismo dato), se muestran; si difieren, queda vacío.
        if (openRecords.length > 0) {
            if (els.responsableSelect) els.responsableSelect.value = commonLastPassValue(openRecords, 'preparado_supervisor');
            if (els.equipoInput) els.equipoInput.value = commonLastPassValue(openRecords, 'preparado_equipo');
            if (els.tipoSelect) els.tipoSelect.value = commonLastPassValue(openRecords, 'preparado_tipo');
            if (els.observacionesInput) els.observacionesInput.value = commonLastPassValue(openRecords, 'preparado_observaciones');
            if (els.turnoInput) els.turnoInput.value = commonLastPassValue(openRecords, 'preparado_turno') || calculateTurno();
            return;
        }

        clearFormFields();
        if (els.turnoInput) els.turnoInput.value = calculateTurno();
    }

    function updateActionButtons() {
        const els = getElements();
        const selectedRecords = Array.from(state.selectedIds)
            .map((id) => findRecordById(id))
            .filter(Boolean);
        const anyOpen = selectedRecords.some((r) => hasOpenPass(r));
        const anyNotOpen = selectedRecords.some((r) => !hasOpenPass(r));

        if (els.inicioBtn) {
            const blockInicio = selectedRecords.length > 0 && !anyNotOpen;
            els.inicioBtn.textContent = blockInicio ? '✓ En proceso' : 'INICIO';
            els.inicioBtn.disabled = blockInicio;
            els.inicioBtn.classList.toggle('button-done', blockInicio);
        }

        if (els.finBtn) {
            const blockFin = selectedRecords.length === 0 || !anyOpen;
            els.finBtn.textContent = blockFin ? '— FIN —' : 'FIN';
            els.finBtn.disabled = blockFin;
            els.finBtn.classList.toggle('button-done', blockFin);
        }
    }

    // --- Selección ---

    function updateSelected(recordId, checked) {
        if (!recordId) return;
        if (checked) { state.selectedIds.add(recordId); } else { state.selectedIds.delete(recordId); }
        renderResults();
    }

    function toggleSelected(recordId) {
        if (!recordId) return;
        updateSelected(recordId, !state.selectedIds.has(recordId));
    }

    function toggleSelectAll() {
        const selectableIds = getSelectableVisibleIds();
        if (!selectableIds.length) return;
        const allSelected = selectableIds.every((id) => state.selectedIds.has(id));
        if (allSelected) {
            selectableIds.forEach((id) => state.selectedIds.delete(id));
        } else {
            selectableIds.forEach((id) => state.selectedIds.add(id));
        }
        renderResults();
    }

    function search(query) {
        state.currentQuery = String(query || '').trim().toUpperCase();
        renderResults();
    }

    // --- QR ---

    async function handleScan() {
        const els = getElements();
        if (!window.TintoreriaQR || typeof TintoreriaQR.scanQrCode !== 'function') {
            showToast('No se encontro el lector QR.');
            return;
        }
        if (els.scanButton) els.scanButton.disabled = true;
        try {
            const rawValue = await TintoreriaQR.scanQrCode();
            const opPartida = TintoreriaQR.normalizeScannedOpPartida(rawValue);
            els.searchInput.value = opPartida;
            search(opPartida);
        } catch (error) {
            const message = error && error.message ? error.message : 'No se pudo escanear el QR.';
            if (message !== 'Escaneo cancelado.') showToast(message);
        } finally {
            if (els.scanButton) els.scanButton.disabled = false;
        }
    }

    // --- Merge de registros actualizados en memoria ---

    function mergeUpdatedRecord(updatedRecord) {
        if (!updatedRecord || !updatedRecord.id_registro) return;
        const targetId = String(updatedRecord.id_registro);
        state.records = state.records.map((r) => {
            if (String(r.id_registro || '') !== targetId) return r;
            return TintoreriaUtils.defaultRecord({ ...r, ...updatedRecord });
        });
    }

    // --- Botón INICIO ---

    async function handleInicio() {
        const els = getElements();
        const responsable = String(els.responsableSelect ? els.responsableSelect.value : '').trim();
        const equipo = TintoreriaUtils.sanitizePlegadoEquipo(els.equipoInput.value || '');
        const tipo = String(els.tipoSelect.value || '').trim();
        const observaciones = String(els.observacionesInput ? els.observacionesInput.value : '')
            .replace(/,/g, ';')
            .replace(/\s+/g, ' ')
            .trim();
        const turno = calculateTurno();
        els.turnoInput.value = turno;
        const ahora = TintoreriaUtils.formatProcessDateTime(new Date());

        if (!responsable) {
            showToast('Selecciona un responsable antes de registrar el inicio.');
            if (els.responsableSelect) els.responsableSelect.focus();
            return;
        }

        if (!equipo) {
            showToast('Ingresa el equipo antes de registrar el inicio.');
            els.equipoInput.focus();
            return;
        }

        if (!TintoreriaUtils.isValidPlegadoEquipo(equipo)) {
            showToast('Equipo solo admite letras y un guion sin espacios (ej: A-B).');
            els.equipoInput.focus();
            return;
        }

        if (!tipo) {
            showToast('Selecciona el tipo antes de registrar el inicio.');
            els.tipoSelect.focus();
            return;
        }

        const updates = Array.from(state.selectedIds)
            .map((recordId) => {
                const record = findRecordById(recordId);
                if (!record || hasOpenPass(record)) return null;
                return {
                    id_registro: recordId,
                    changes: {
                        preparado_turno: appendPassValue(record.preparado_turno, turno),
                        preparado_supervisor: appendPassValue(record.preparado_supervisor, responsable),
                        preparado_equipo: appendPassValue(record.preparado_equipo, equipo),
                        preparado_tipo: appendPassValue(record.preparado_tipo, tipo),
                        preparado_observaciones: appendPassValue(record.preparado_observaciones, observaciones),
                        preparado_inicio: appendPassValue(record.preparado_inicio, ahora),
                        preparado_estado: 'PROG'
                    }
                };
            })
            .filter(Boolean);

        if (!updates.length) {
            showToast('Las filas seleccionadas ya tienen un pase abierto. Registra el FIN primero.');
            return;
        }

        els.inicioBtn.disabled = true;
        els.inicioBtn.textContent = 'Guardando...';

        try {
            const response = await TintoreriaAPI.updateRecords(updates);
            (response.records || []).forEach(mergeUpdatedRecord);
            renderResults();
            showToast(`Inicio registrado en ${updates.length} fila(s).`);
        } catch (error) {
            showToast(error && error.message ? error.message : 'No se pudo registrar el inicio.');
        } finally {
            updateActionButtons();
        }
    }

    // --- Botón FIN ---

    async function handleFin() {
        const els = getElements();
        const ahora = TintoreriaUtils.formatProcessDateTime(new Date());

        const updates = Array.from(state.selectedIds)
            .map((recordId) => {
                const record = findRecordById(recordId);
                if (!record || !hasOpenPass(record)) return null;
                // El pase que se cierra es el último (el que está abierto).
                const closingPassTipo = lastPassValue(record, 'preparado_tipo');
                // "Terminado" solo si este pase completa el preparado o ya había un
                // pase de cierre previo. Si es solo DOBLADO/DOB-REPROCESO, queda EN PROCESO.
                const terminado = isClosingTipo(closingPassTipo) || hasClosedClosingPass(record);
                return {
                    id_registro: recordId,
                    changes: {
                        preparado_fin: appendPassValue(record.preparado_fin, ahora),
                        preparado_estado: terminado ? 'OK' : 'PROG'
                    }
                };
            })
            .filter(Boolean);

        if (!updates.length) {
            showToast('Las filas seleccionadas no tienen un pase abierto para cerrar.');
            return;
        }

        els.finBtn.disabled = true;
        els.finBtn.textContent = 'Guardando...';

        try {
            const response = await TintoreriaAPI.updateRecords(updates);
            (response.records || []).forEach(mergeUpdatedRecord);
            renderResults();
            showToast(`Fin registrado en ${updates.length} fila(s).`);
        } catch (error) {
            showToast(error && error.message ? error.message : 'No se pudo registrar el fin.');
        } finally {
            updateActionButtons();
        }
    }

    // --- Responsable (siempre todas las opciones) ---

    function setupResponsable() {
        const els = getElements();
        if (!els.responsableSelect) return;
        els.responsableSelect.innerHTML = `
            <option value="">Seleccionar...</option>
            <option value="Molero Jacinto">Molero Jacinto</option>
            <option value="Porras Quinto">Porras Quinto</option>
            <option value="Carrion">Carrion</option>
            <option value="Otro">Otro</option>
        `;
        els.responsableSelect.disabled = false;
    }

    // --- Keyboard dismiss ---

    function isEditableTarget(target) {
        return target instanceof Element &&
            Boolean(target.closest('input, textarea, select, [contenteditable="true"], label'));
    }

    function dismissKeyboardIfNeeded(target) {
        if (isEditableTarget(target)) return;
        const active = document.activeElement;
        if (!(active instanceof HTMLElement)) return;
        if (!active.matches('input, textarea, select, [contenteditable="true"]')) return;
        active.blur();
    }

    // --- Eventos ---

    function bindEvents() {
        const els = getElements();
        if (!els.form || !els.searchInput || !els.resultList || !els.inicioBtn || !els.finBtn || !els.selectAllBtn) return;

        document.addEventListener('pointerdown', (event) => {
            dismissKeyboardIfNeeded(event.target);
        });

        els.form.addEventListener('submit', (event) => {
            event.preventDefault();
            search(els.searchInput.value);
        });

        els.searchInput.addEventListener('input', () => {
            search(els.searchInput.value);
        });

        els.resultList.addEventListener('change', (event) => {
            const target = event.target;
            if (!(target instanceof HTMLInputElement)) return;
            if (!target.classList.contains('preparado-mobile-checkbox')) return;
            updateSelected(target.dataset.recordId || '', target.checked);
        });

        els.resultList.addEventListener('click', (event) => {
            const target = event.target;
            if (!(target instanceof Element)) return;
            if (target.closest('.checkbox-label') || target.closest('.preparado-mobile-checkbox')) return;
            const card = target.closest('.record-card-selectable');
            if (!card) return;
            toggleSelected(card.getAttribute('data-record-id') || '');
        });

        els.selectAllBtn.addEventListener('click', toggleSelectAll);
        els.inicioBtn.addEventListener('click', handleInicio);
        els.finBtn.addEventListener('click', handleFin);
        if (els.scanButton) els.scanButton.addEventListener('click', handleScan);
        const turno = calculateTurno();
        els.turnoInput.value = turno;
        setupResponsable();
    }

    // --- Carga de datos ---

    async function hydrateFromCache() {
        if (!window.TintoreriaAPI || typeof TintoreriaAPI.getCachedRecords !== 'function') return false;
        const cached = TintoreriaAPI.getCachedRecords();
        if (!cached || !Array.isArray(cached.records) || !cached.records.length) return false;
        setRecords(cached.records);
        setSyncStatus(`Mostrando cache local (${cached.records.length} registros). Sincronizando...`);
        renderResults();
        return true;
    }

    async function refreshRemoteRecords() {
        if (!window.TintoreriaAPI || typeof TintoreriaAPI.listRecords !== 'function') {
            setSyncStatus('No se encontro la API configurada.', true);
            return;
        }
        state.syncing = true;
        setSyncStatus('Sincronizando datos con la web...');
        try {
            const response = await TintoreriaAPI.listRecords();
            setRecords(response.records || []);
            renderResults();
            setSyncStatus('');
        } catch (error) {
            setSyncStatus(error && error.message ? error.message : 'No se pudo sincronizar la informacion.', true);
        } finally {
            state.syncing = false;
        }
    }

    async function init() {
        bindEvents();
        await hydrateFromCache();
        await refreshRemoteRecords();
    }

    document.addEventListener('DOMContentLoaded', init);
})();
