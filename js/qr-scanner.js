(() => {
    const state = {
        modal: null,
        stream: null,
        rafId: 0,
        detector: null,
        running: false
    };

    function getCameraErrorMessage(error) {
        const name = error && error.name ? error.name : '';

        if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
            return 'Permite el acceso a la camara para escanear el QR.';
        }

        if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
            return 'No se encontro una camara disponible.';
        }

        if (name === 'NotReadableError' || name === 'TrackStartError') {
            return 'No se pudo iniciar la camara. Verifica que no este en uso.';
        }

        return error && error.message ? error.message : 'No se pudo iniciar el escaner QR.';
    }

    function normalizeScannedOpPartida(rawValue) {
        const digits = String(rawValue || '').replace(/\D/g, '');

        if (digits.length <= 8) {
            throw new Error('El QR no contiene un codigo OP-PTDA valido.');
        }

        const withoutPrefix = digits.slice(3);
        const cleanNumber = withoutPrefix.replace(/^0+/, '');

        if (cleanNumber.length <= 5) {
            throw new Error('El QR no contiene partida para convertir.');
        }

        const op = cleanNumber.slice(0, 5);
        const partida = cleanNumber.slice(5).replace(/^0+/, '') || '0';

        return `${op}-${partida}`;
    }

    function ensureModal() {
        if (state.modal) {
            return state.modal;
        }

        const modal = document.createElement('div');
        modal.className = 'qr-scanner-backdrop hidden';
        modal.innerHTML = `
            <div class="qr-scanner-card" role="dialog" aria-modal="true" aria-label="Escanear QR">
                <div class="qr-scanner-head">
                    <div>
                        <h3>Escanear QR</h3>
                    </div>
                    <button type="button" class="qr-scanner-close" aria-label="Cerrar escaner">x</button>
                </div>
                <div class="qr-video-wrap">
                    <video class="qr-scanner-video" autoplay muted playsinline></video>
                    <span class="qr-scan-frame" aria-hidden="true"></span>
                </div>
                <p class="qr-scanner-status">Iniciando camara...</p>
            </div>
        `;

        document.body.appendChild(modal);
        state.modal = modal;
        return modal;
    }

    function stopScan() {
        state.running = false;

        if (state.rafId) {
            window.cancelAnimationFrame(state.rafId);
            state.rafId = 0;
        }

        if (state.stream) {
            state.stream.getTracks().forEach((track) => track.stop());
            state.stream = null;
        }

        if (state.modal) {
            const video = state.modal.querySelector('.qr-scanner-video');
            if (video) {
                video.srcObject = null;
            }

            state.modal.classList.add('hidden');
        }
    }

    async function getDetector() {
        if (!('BarcodeDetector' in window)) {
            throw new Error('Este navegador no soporta escaneo QR directo. Prueba desde Chrome/Edge movil con HTTPS.');
        }

        if (!state.detector) {
            state.detector = new BarcodeDetector({ formats: ['qr_code'] });
        }

        return state.detector;
    }

    function requestCamera() {
        if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
            throw new Error('Abre la pagina con HTTPS o localhost para permitir el uso de la camara.');
        }

        return navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: { ideal: 'environment' }
            },
            audio: false
        });
    }

    function scanQrCode() {
        return new Promise(async (resolve, reject) => {
            let detector;
            let settled = false;
            const modal = ensureModal();
            const video = modal.querySelector('.qr-scanner-video');
            const status = modal.querySelector('.qr-scanner-status');
            const closeButton = modal.querySelector('.qr-scanner-close');

            function finish(error, value) {
                if (settled) {
                    return;
                }

                settled = true;
                stopScan();

                if (closeButton) {
                    closeButton.removeEventListener('click', handleCancel);
                }

                if (error) {
                    reject(error);
                } else {
                    resolve(value);
                }
            }

            function handleCancel() {
                finish(new Error('Escaneo cancelado.'));
            }

            async function tick() {
                if (!state.running || settled) {
                    return;
                }

                try {
                    const barcodes = await detector.detect(video);
                    const qrCode = (barcodes || []).find((barcode) => String(barcode.format || '').toLowerCase() === 'qr_code');

                    if (qrCode && qrCode.rawValue) {
                        finish(null, qrCode.rawValue);
                        return;
                    }
                } catch (error) {
                    finish(error);
                    return;
                }

                state.rafId = window.requestAnimationFrame(tick);
            }

            try {
                detector = await getDetector();

                if (!video) {
                    throw new Error('No se pudo preparar la vista de camara.');
                }

                if (closeButton) {
                    closeButton.addEventListener('click', handleCancel);
                }

                modal.classList.remove('hidden');
                if (status) status.textContent = 'Iniciando camara...';

                state.stream = await requestCamera();
                video.srcObject = state.stream;
                await video.play();

                state.running = true;
                if (status) status.textContent = 'Buscando codigo QR...';
                tick();
            } catch (error) {
                finish(new Error(getCameraErrorMessage(error)));
            }
        });
    }

    window.TintoreriaQR = {
        normalizeScannedOpPartida,
        scanQrCode,
        stopScan
    };
})();
