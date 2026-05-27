(() => {
    const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    const MONTH_MAP = {
        ene: 0,
        feb: 1,
        mar: 2,
        abr: 3,
        may: 4,
        jun: 5,
        jul: 6,
        ago: 7,
        sep: 8,
        oct: 9,
        nov: 10,
        dic: 11
    };

    function normalizeHeader(value) {
        return String(value === undefined || value === null ? '' : value)
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .toUpperCase();
    }

    function escapeHtml(value) {
        return String(value === undefined || value === null ? '' : value).replace(/[&<>"']/g, (character) => {
            const entities = {
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;'
            };
            return entities[character];
        });
    }

    function formatColorLabel(value) {
        return String(value === undefined || value === null ? '' : value)
            .replace(/\bHEATHERED\b/gi, 'HTR')
            .trim();
    }

    function normalizeNumericString(value) {
        const rawValue = String(value === undefined || value === null ? '' : value)
            .replace(/\s+/g, '')
            .trim();

        if (!rawValue) {
            return '';
        }

        const cleaned = rawValue.replace(/[^\d,.-]/g, '');
        if (!cleaned) {
            return '';
        }

        const lastComma = cleaned.lastIndexOf(',');
        const lastDot = cleaned.lastIndexOf('.');

        if (lastComma !== -1 && lastDot !== -1) {
            return lastComma > lastDot
                ? cleaned.replace(/\./g, '').replace(',', '.')
                : cleaned.replace(/,/g, '');
        }

        if (lastComma !== -1) {
            const decimalLength = cleaned.length - lastComma - 1;
            return decimalLength === 3
                ? cleaned.replace(/,/g, '')
                : cleaned.replace(/\./g, '').replace(',', '.');
        }

        if (lastDot !== -1) {
            const decimalLength = cleaned.length - lastDot - 1;
            return decimalLength === 3
                ? cleaned.replace(/\./g, '')
                : cleaned.replace(/,/g, '');
        }

        return cleaned;
    }

    function toNumber(value) {
        if (value === null || value === undefined || value === '') {
            return 0;
        }

        if (typeof value === 'number') {
            return Number.isFinite(value) ? value : 0;
        }

        const normalized = normalizeNumericString(value);
        if (!normalized) {
            return 0;
        }

        const parsed = Number(normalized);
        return Number.isFinite(parsed) ? parsed : 0;
    }

    function parseNumericCell(value) {
        if (value === null || value === undefined || value === '') {
            return '';
        }

        if (typeof value === 'number') {
            return Number.isFinite(value) ? value : '';
        }

        const normalized = normalizeNumericString(value);
        if (!normalized) {
            return '';
        }

        const parsed = Number(normalized);
        return Number.isFinite(parsed) ? parsed : '';
    }

    function formatNumber(value, decimals = 2) {
        return toNumber(value).toLocaleString('es-PE', {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals
        });
    }

    function parseDateish(value) {
        if (!value) {
            return null;
        }

        if (value instanceof Date && !Number.isNaN(value.getTime())) {
            return new Date(value.getTime());
        }

        if (typeof value === 'number' && Number.isFinite(value) && window.XLSX && window.XLSX.SSF && window.XLSX.SSF.parse_date_code) {
            const parsed = XLSX.SSF.parse_date_code(value);
            if (parsed) {
                return new Date(parsed.y, parsed.m - 1, parsed.d, parsed.H || 0, parsed.M || 0, parsed.S || 0);
            }
        }

        const raw = String(value).trim();
        if (!raw) {
            return null;
        }

        const numericDateTimeMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
        if (numericDateTimeMatch) {
            const day = Number(numericDateTimeMatch[1]);
            const month = Number(numericDateTimeMatch[2]) - 1;
            const year = Number(numericDateTimeMatch[3]);
            const hours = Number(numericDateTimeMatch[4] || 0);
            const minutes = Number(numericDateTimeMatch[5] || 0);
            const seconds = Number(numericDateTimeMatch[6] || 0);

            if (
                Number.isInteger(day) &&
                Number.isInteger(month) &&
                Number.isInteger(year) &&
                Number.isInteger(hours) &&
                Number.isInteger(minutes) &&
                Number.isInteger(seconds) &&
                month >= 0 &&
                month <= 11
            ) {
                return new Date(year, month, day, hours, minutes, seconds, 0);
            }
        }

        const processDateTimeMatch = raw.match(/^(\d{1,2})\/([A-Za-z]{3})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/);
        if (processDateTimeMatch) {
            const day = Number(processDateTimeMatch[1]);
            const month = MONTH_MAP[processDateTimeMatch[2].toLowerCase()];
            const year = Number(processDateTimeMatch[3]);
            let hours = Number(processDateTimeMatch[4]);
            const minutes = Number(processDateTimeMatch[5]);
            const suffix = processDateTimeMatch[6].toLowerCase();

            if (suffix === 'pm' && hours < 12) {
                hours += 12;
            }

            if (suffix === 'am' && hours === 12) {
                hours = 0;
            }

            if (
                Number.isInteger(day) &&
                Number.isInteger(month) &&
                Number.isInteger(year) &&
                Number.isInteger(hours) &&
                Number.isInteger(minutes)
            ) {
                return new Date(year, month, day, hours, minutes, 0, 0);
            }
        }

        const isoCandidate = raw.includes(' ') && !raw.includes('T') ? raw.replace(' ', 'T') : raw;
        const direct = new Date(isoCandidate);
        if (!Number.isNaN(direct.getTime())) {
            return direct;
        }

        const shortMatch = raw.match(/^(\d{1,2})\/([A-Za-z]{3})\/(\d{4})$/);
        if (shortMatch) {
            const day = Number(shortMatch[1]);
            const month = MONTH_MAP[shortMatch[2].toLowerCase()];
            const year = Number(shortMatch[3]);
            if (Number.isInteger(day) && Number.isInteger(month) && Number.isInteger(year)) {
                return new Date(year, month, day);
            }
        }

        return null;
    }

    function formatDateForUi(value) {
        const date = parseDateish(value);
        if (!date) {
            return String(value === undefined || value === null ? '' : value).trim();
        }

        const day = String(date.getDate()).padStart(2, '0');
        const month = MONTHS[date.getMonth()];
        const year = date.getFullYear();
        return `${day}/${month}/${year}`;
    }

    function formatDateDayMonth(value) {
        const date = parseDateish(value);
        if (!date) {
            return String(value === undefined || value === null ? '' : value).trim();
        }

        const day = String(date.getDate()).padStart(2, '0');
        const month = MONTHS[date.getMonth()];
        return `${day}/${month}`;
    }

    function formatDateTimeShort(value) {
        const date = parseDateish(value);
        if (!date) {
            return '';
        }

        const day = String(date.getDate()).padStart(2, '0');
        const month = MONTHS[date.getMonth()];
        const year = date.getFullYear();
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${day}/${month}/${year} ${hours}:${minutes}`;
    }

    function formatTimeAmPm(date) {
        const source = parseDateish(date) || date;
        if (!(source instanceof Date) || Number.isNaN(source.getTime())) {
            return '';
        }

        const hours24 = source.getHours();
        const hours12 = hours24 % 12 || 12;
        const minutes = String(source.getMinutes()).padStart(2, '0');
        const suffix = hours24 >= 12 ? 'pm' : 'am';
        return `${String(hours12).padStart(2, '0')}:${minutes}${suffix}`;
    }

    function formatProcessDateTime(value) {
        const date = parseDateish(value);
        if (!date) {
            return '';
        }

        const day = String(date.getDate()).padStart(2, '0');
        const month = MONTHS[date.getMonth()];
        const year = date.getFullYear();
        return `${day}/${month}/${year} ${formatTimeAmPm(date)}`;
    }

    function formatProcessDateTimeLabel(value) {
        const date = parseDateish(value);
        if (!date) {
            return '';
        }

        const day = String(date.getDate()).padStart(2, '0');
        const month = MONTHS[date.getMonth()];
        return `${day}/${month} ${formatTimeAmPm(date)}`;
    }

    function formatElapsedTime(startValue, endValue = null) {
        const startDate = parseDateish(startValue);
        const endDate = parseDateish(endValue) || new Date();
        if (!startDate || !endDate) {
            return '';
        }

        const diffMs = Math.max(0, endDate.getTime() - startDate.getTime());
        const totalMinutes = Math.floor(diffMs / 60000);
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    }

    function calculateProductionTurno(value = new Date()) {
        const date = parseDateish(value) || value;
        if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
            return '';
        }

        const hours = date.getHours();
        if (hours >= 6 && hours < 14) return '1T';
        if (hours >= 14 && hours < 23) return '2T';
        return '3T';
    }

    function parseExcelDate(value) {
        if (value === null || value === undefined || value === '') {
            return '';
        }

        const formatted = formatDateForUi(value);
        return formatted || String(value).trim();
    }

    function digitsOnly(value, maxDigits = 3) {
        return String(value === undefined || value === null ? '' : value).replace(/\D/g, '').slice(0, maxDigits);
    }

    function sanitizeAncho(value) {
        const digits = digitsOnly(value, 3);
        if (!digits) {
            return '';
        }

        if (digits.length < 2) {
            return '';
        }

        const numericValue = Number(digits);
        if (numericValue > 240) {
            return '240';
        }

        return String(numericValue);
    }

    function sanitizeDensidad(value) {
        const digits = digitsOnly(value, 3);
        if (!digits) {
            return '';
        }

        return digits.length >= 2 ? digits : '';
    }

    function sanitizePlegadoP(value) {
        return digitsOnly(value, 3);
    }

    function sanitizePlegadoEquipo(value) {
        const compact = String(value === undefined || value === null ? '' : value)
            .toUpperCase()
            .replace(/\s+/g, '')
            .replace(/[^A-Z-]/g, '');

        const parts = compact.split('-').filter(Boolean);
        if (!parts.length) {
            return '';
        }

        const tail = parts.slice(1).join('');
        return tail ? `${parts[0]}-${tail}` : parts[0];
    }

    function isValidPlegadoEquipo(value) {
        if (!value) {
            return true;
        }

        return /^[A-Z]+(?:-[A-Z]+)?$/.test(value);
    }

    function sanitizeUppercaseText(value) {
        return String(value === undefined || value === null ? '' : value)
            .replace(/\r\n/g, '\n')
            .toUpperCase()
            .trim();
    }

    function sanitizeNumericRatio(value) {
        return String(value === undefined || value === null ? '' : value)
            .replace(/\s+/g, '')
            .replace(/[^0-9/]/g, '');
    }

    function isValidNumericRatio(value, maxDigitsPerPart = 2) {
        if (!value) {
            return true;
        }

        const digitsPattern = new RegExp(`^\\d{1,${maxDigitsPerPart}}$`);
        const ratioPattern = new RegExp(`^\\d{1,${maxDigitsPerPart}}\\/\\d{1,${maxDigitsPerPart}}$`);
        return digitsPattern.test(value) || ratioPattern.test(value);
    }

    function sanitizePersonName(value) {
        return String(value === undefined || value === null ? '' : value)
            .toUpperCase()
            .replace(/\s+/g, ' ')
            .trim();
    }

    function isValidPersonName(value) {
        if (!value) {
            return true;
        }

        return /^[A-Za-zÁÉÍÓÚáéíóúÑñÜü]+(?: [A-Za-zÁÉÍÓÚáéíóúÑñÜü]+)?$/.test(value);
    }

    function formatOpPartida(opTela, partida) {
        const opValue = String(opTela === undefined || opTela === null ? '' : opTela).trim();
        const partidaValue = String(partida === undefined || partida === null ? '' : partida).trim();

        if (opValue && partidaValue) {
            return `${opValue}-${partidaValue}`;
        }

        return opValue || partidaValue;
    }

    function normalizeRecordKeyPart(value) {
        const normalized = String(value === undefined || value === null ? '' : value)
            .trim()
            .toUpperCase();

        if (!normalized) {
            return '';
        }

        if (/^\d+$/.test(normalized)) {
            return normalized.replace(/^0+/, '') || '0';
        }

        return normalized;
    }

    function buildMaestroDuplicateKey(opTela, partida, codArt, color) {
        const opValue = normalizeRecordKeyPart(opTela);
        const partidaValue = normalizeRecordKeyPart(partida);
        const codArtValue = normalizeRecordKeyPart(codArt);
        const colorValue = normalizeRecordKeyPart(color);

        if (!opValue && !partidaValue && !codArtValue && !colorValue) {
            return '';
        }

        return `${opValue}|${partidaValue}|${codArtValue}|${colorValue}`;
    }

    function buildRecordMatchKey(record = {}) {
        return buildMaestroDuplicateKey(record.op_tela, record.partida, record.cod_art, record.color);
    }

    function getPriorityValue(value) {
        const digits = String(value === undefined || value === null ? '' : value)
            .replace(/\D/g, '')
            .trim();

        if (!digits) {
            return Number.POSITIVE_INFINITY;
        }

        return Number(digits);
    }

    function sortRecordsByPriority(records, fieldName) {
        return [...records].sort((left, right) => {
            const leftPriority = getPriorityValue(left[fieldName]);
            const rightPriority = getPriorityValue(right[fieldName]);

            if (leftPriority === rightPriority) {
                const leftOpPartida = formatOpPartida(left && left.op_tela, left && left.partida);
                const rightOpPartida = formatOpPartida(right && right.op_tela, right && right.partida);

                if (!leftOpPartida && !rightOpPartida) {
                    return 0;
                }

                if (!leftOpPartida) {
                    return 1;
                }

                if (!rightOpPartida) {
                    return -1;
                }

                return leftOpPartida.localeCompare(rightOpPartida, 'es', {
                    numeric: true,
                    sensitivity: 'base'
                });
            }

            return leftPriority - rightPriority;
        });
    }

    function isUrgentPriority(value) {
        return getPriorityValue(value) === 1;
    }

    function summarizeWeight(records, fieldName = 'peso_kg_crudo') {
        return (records || []).reduce((total, record) => {
            return total + toNumber(record && record[fieldName]);
        }, 0);
    }

    function formatSubtabSummary(records, fieldName = 'peso_kg_crudo') {
        const weight = summarizeWeight(records, fieldName);
        return `[${formatNumber(weight)}kg]`;
    }

    function normalizeOpPartidaSearchValue(value) {
        return String(value === undefined || value === null ? '' : value)
            .toUpperCase()
            .replace(/\s+/g, '')
            .replace(/[^A-Z0-9]/g, '')
            .trim();
    }

    function filterRecordsForSearch(records, state, viewId) {
        const activeSearch = state && state.activeSearch;
        if (!activeSearch || activeSearch.viewId !== viewId) {
            return [...(records || [])];
        }

        const normalizedSearchValue = normalizeOpPartidaSearchValue(activeSearch.searchValue || activeSearch.query || '');
        if (normalizedSearchValue) {
            return (records || []).filter((record) => {
                if (!record) {
                    return false;
                }

                return normalizeOpPartidaSearchValue(formatOpPartida(record.op_tela, record.partida)) === normalizedSearchValue;
            });
        }

        if (!activeSearch.recordId) {
            return [...(records || [])];
        }

        return (records || []).filter((record) => record && record.id_registro === activeSearch.recordId);
    }

    function extractTelaData(guiaValue) {
        const digits = String(guiaValue === undefined || guiaValue === null ? '' : guiaValue).replace(/\D/g, '');
        if (digits.length < 4) {
            return {
                tipoTela: '',
                opTela: ''
            };
        }

        const tipoTela = digits.slice(0, 3);
        const opTela = String(parseInt(digits.slice(3), 10) || '');
        return { tipoTela, opTela };
    }

    function defaultRecord(record = {}) {
        const base = Object.fromEntries(MASTER_HEADERS.map((header) => [header, '']));
        return {
            ...base,
            plegado_estado: 'X PROG',
            rama_crudo_estado: 'X PROG',
            preparado_estado: 'X PROG',
            tenido_estado: 'X PROG',
            abridora_estado: 'X PROG',
            rama_tenido_estado: 'X PROG',
            acabado_especial_estado: 'X PROG',
            acab_espec_estado: 'X PROG',
            calidad_estado: '',
            ...record
        };
    }

    function sortRecords(records) {
        return [...records].sort((left, right) => {
            const leftDate = parseDateish(left.F_ing_crudo) || parseDateish(left.fecha_registro) || new Date(0);
            const rightDate = parseDateish(right.F_ing_crudo) || parseDateish(right.fecha_registro) || new Date(0);
            return rightDate.getTime() - leftDate.getTime();
        });
    }

    function hasConfiguredWebAppUrl() {
        return typeof WEB_APP_URL === 'string' && WEB_APP_URL.trim() !== '' && !WEB_APP_URL.includes('PEGA_AQUI');
    }

    window.TintoreriaUtils = {
        normalizeHeader,
        escapeHtml,
        formatColorLabel,
        parseNumericCell,
        toNumber,
        formatNumber,
        parseDateish,
        formatDateForUi,
        formatDateDayMonth,
        formatDateTimeShort,
        formatProcessDateTime,
        formatProcessDateTimeLabel,
        formatElapsedTime,
        calculateProductionTurno,
        parseExcelDate,
        sanitizeAncho,
        sanitizeDensidad,
        sanitizePlegadoP,
        sanitizePlegadoEquipo,
        isValidPlegadoEquipo,
        sanitizeUppercaseText,
        sanitizeNumericRatio,
        isValidNumericRatio,
        sanitizePersonName,
        isValidPersonName,
        formatOpPartida,
        buildMaestroDuplicateKey,
        buildRecordMatchKey,
        sortRecordsByPriority,
        isUrgentPriority,
        summarizeWeight,
        formatSubtabSummary,
        normalizeOpPartidaSearchValue,
        filterRecordsForSearch,
        extractTelaData,
        defaultRecord,
        sortRecords,
        hasConfiguredWebAppUrl
    };
})();
