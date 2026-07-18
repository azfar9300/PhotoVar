document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

function initApp() {
    let peer;
    let dataConn; 
    let currentCall; 
    let localStream;
    let hasControl = true;
    let isCapturing = false;
    let capturedPhotos = [];

    const videoLocal = document.getElementById('video-local');
    const videoRemote = document.getElementById('video-remote');
    const canvasLocal = document.getElementById('canvas-local');
    const canvasRemote = document.getElementById('canvas-remote');
    const canvasComposite = document.getElementById('canvas-composite');
    const stripCanvas = document.getElementById('photos-strip');

    const ctxLocal = canvasLocal.getContext('2d');
    const ctxRemote = canvasRemote.getContext('2d');
    const ctxComposite = canvasComposite.getContext('2d');
    const stripCtx = stripCanvas.getContext('2d');

    const btnCall = document.getElementById('btn-call');
    const btnSnap = document.getElementById('btn-snap');
    const btnPass = document.getElementById('btn-pass');
    const btnDownload = document.getElementById('btn-download');

    const peerIdInput = document.getElementById('peer-id-input');
    const connectionStatus = document.getElementById('connection-status');
    const currentControllerText = document.getElementById('current-controller');
    const countdownEl = document.getElementById('countdown');

    if (typeof SelfieSegmentation === 'undefined') {
        console.error("Library MediaPipe SelfieSegmentation gagal dimuat.");
        connectionStatus.innerText = "Error: Gagal memuat AI Library.";
        return;
    }

    function generateShortId(length = 8) {
        const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        for (let i = 0; i < length; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }

    // 1. MEDIAPIPE AI SETUP
    const aiLocal = new SelfieSegmentation({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}` });
    const aiRemote = new SelfieSegmentation({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}` });

    aiLocal.setOptions({ modelSelection: 1 }); 
    aiRemote.setOptions({ modelSelection: 1 });

    aiLocal.onResults((results) => onSegmentationResults(results, ctxLocal, canvasLocal));
    aiRemote.onResults((results) => onSegmentationResults(results, ctxRemote, canvasRemote));

    function onSegmentationResults(results, ctx, canvas) {
        ctx.save();
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(results.segmentationMask, 0, 0, canvas.width, canvas.height);
        ctx.globalCompositeOperation = 'source-in';
        ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
        ctx.restore();
    }

    // 2. MAIN COMPOSITING
    function drawCompositeStage() {
        ctxComposite.clearRect(0, 0, canvasComposite.width, canvasComposite.height);
        
        const orangW = 640;
        const orangH = 480;
        const paddingBawah = 0; 

        // Cek apakah ada kamera remote yang aktif terhubung
        const isRemoteActive = videoRemote.srcObject && !videoRemote.paused;

        if (localStream) {
            // Jika berdua, posisi agak geser ke kiri (+100). Jika sendirian, posisi otomatis center pas di tengah (0).
            const offsetJarak = isRemoteActive ? 100 : 0; 
            const xLokal = 0 + (canvasComposite.width / 2 - orangW) / 2 + offsetJarak; 
            const yLokal = canvasComposite.height - orangH - paddingBawah;
            ctxComposite.drawImage(canvasLocal, xLokal, yLokal, orangW, orangH);
        }

        if (isRemoteActive) {
            const xRemote = canvasComposite.width / 2 + (canvasComposite.width / 2 - orangW) / 2 - 100; 
            const yRemote = canvasComposite.height - orangH - paddingBawah;
            ctxComposite.drawImage(canvasRemote, xRemote, yRemote, orangW, orangH);
        }

        requestAnimationFrame(drawCompositeStage);
    }

    navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false })
        .then(stream => {
            localStream = stream;
            videoLocal.srcObject = stream;
            videoLocal.addEventListener('playing', () => {
                async function detectionFrameLokal() {
                    if (!videoLocal.paused && !videoLocal.ended) {
                        await aiLocal.send({ image: videoLocal });
                    }
                    requestAnimationFrame(detectionFrameLokal);
                }
                detectionFrameLokal();
            });
            drawCompositeStage();
        })
        .catch(err => {
            console.error("Akses kamera gagal:", err);
            alert("Harap izinkan akses kamera!");
        });

    // 3. NETWORK CONNECTIONS WITH ICE SERVERS (STUN/TURN)
    const customId = generateShortId(8);
    
    peer = new Peer(customId, {
        config: {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' },
                {
                    urls: 'turn:openrelay.metered.ca:80',
                    username: 'openrelay',
                    credential: 'openrelay'
                },
                {
                    urls: 'turn:openrelay.metered.ca:443',
                    username: 'openrelay',
                    credential: 'openrelay'
                }
            ],
            sdpSemantics: 'unified-plan'
        }
    }); 

    peer.on('open', (id) => {
        document.getElementById('my-id').innerText = id;
    });

    peer.on('call', (call) => {
        connectionStatus.innerText = "Menerima panggilan video...";
        call.answer(localStream);
        handleCall(call);
    });

    peer.on('connection', (incomingDataConn) => {
        dataConn = incomingDataConn;
        setupDataListeners();
        connectionStatus.innerText = "Terhubung dengan teman!";
        hasControl = false; 
        updateControlUI();
    });

    btnCall.addEventListener('click', () => {
        const peerId = peerIdInput.value.trim().toLowerCase();
        if (peerId.length !== 8) return alert("Masukkan ID 8 Karakter!");
        
        connectionStatus.innerText = "Memanggil teman...";
        
        const call = peer.call(peerId, localStream);
        handleCall(call);

        dataConn = peer.connect(peerId);
        setupDataListeners();
    });

    function handleCall(call) {
        currentCall = call;
        call.on('stream', (remoteStream) => {
            videoRemote.srcObject = remoteStream;
            videoRemote.addEventListener('playing', () => {
                connectionStatus.innerText = "Satu panggung berdua!";
                async function detectionFrameRemote() {
                    if (!videoRemote.paused && !videoRemote.ended) {
                        await aiRemote.send({ image: videoRemote });
                    }
                    requestAnimationFrame(detectionFrameRemote);
                }
                detectionFrameRemote();
            });
        });
        
        call.on('close', () => {
            connectionStatus.innerText = "Koneksi terputus. Beralih ke mode sendiri.";
            updateControlUI();
        });
        call.on('error', (err) => {
            console.error("Call error:", err);
            connectionStatus.innerText = "Gagal menyambungkan video.";
        });
    }

    function setupDataListeners() {
        dataConn.on('open', () => {
            updateControlUI();
        });

        dataConn.on('data', (data) => {
            if (data.type === 'START_SHOOT') {
                runShootSequence();
            } else if (data.type === 'PASS_CONTROL') {
                hasControl = true;
                updateControlUI();
            }
        });

        dataConn.on('close', () => {
            dataConn = null;
            connectionStatus.innerText = "Koneksi data terputus. Mode sendiri aktif.";
            hasControl = true;
            updateControlUI();
        });
    }

    function updateControlUI() {
        if (!dataConn) {
            currentControllerText.innerText = "Mode Sendiri (Solo)";
            btnSnap.disabled = false;
            btnPass.disabled = true; // Tidak bisa lempar kendali kalau sendirian
        } else {
            currentControllerText.innerText = hasControl ? "Lokal (Anda)" : "Teman Anda";
            btnSnap.disabled = !hasControl;
            btnPass.disabled = !hasControl;
        }
    }

    btnPass.addEventListener('click', () => {
        if (!dataConn) return;
        hasControl = false;
        updateControlUI();
        dataConn.send({ type: 'PASS_CONTROL' });
    });

    // 4. SHUTTER & PHOTOS STRIP
    btnSnap.addEventListener('click', () => {
        // PERUBAHAN UTAMA: Jika tidak ada teman, langsung jalankan jepretan lokal saja
        if (!dataConn) {
            runShootSequence();
        } else {
            if (!hasControl) return alert("Tunggu giliran kendali dari device teman.");
            dataConn.send({ type: 'START_SHOOT' }); 
            runShootSequence();
        }
    });

    function runShootSequence() {
        if (isCapturing) return;
        isCapturing = true;
        capturedPhotos = [];
        let photoCount = 0;
        
        // Nonaktifkan tombol saat proses foto berlangsung
        btnSnap.disabled = true;
        
        function takeNext() {
            let timeLeft = 3;
            countdownEl.innerText = timeLeft;

            let interval = setInterval(() => {
                timeLeft--;
                if (timeLeft > 0) {
                    countdownEl.innerText = timeLeft;
                } else {
                    clearInterval(interval);
                    countdownEl.innerText = "📸"; 
                    
                    setTimeout(() => {
                        countdownEl.innerText = "";
                        captureFrameToArray();
                        photoCount++;
                        
                        if (photoCount < 3) {
                            takeNext();
                        } else {
                            isCapturing = false;
                            updateControlUI(); // Kembalikan state tombol
                            generatePhotoboothCard();
                        }
                    }, 400); 
                }
            }, 1000);
        }
        takeNext();
    }

    function captureFrameToArray() {
        const memCanvas = document.createElement('canvas');
        memCanvas.width = canvasComposite.width;
        memCanvas.height = canvasComposite.height;
        const memCtx = memCanvas.getContext('2d');
        memCtx.drawImage(canvasComposite, 0, 0);
        capturedPhotos.push(memCanvas);
    }

    function generatePhotoboothCard() {
        if (capturedPhotos.length < 3) return;
        
        stripCtx.clearRect(0, 0, stripCanvas.width, stripCanvas.height);
        
        stripCtx.fillStyle = "#FFFFFF";
        stripCtx.fillRect(0, 0, stripCanvas.width, stripCanvas.height);
        
        const targetW = 540;  
        const targetH = 304;  
        const paddingX = 30;  
        let yOffset = 60;     

        capturedPhotos.forEach((photo) => {
            stripCtx.fillStyle = "rgba(0, 0, 0, 0.05)";
            stripCtx.fillRect(paddingX + 4, yOffset + 4, targetW, targetH);
            
            stripCtx.drawImage(photo, paddingX, yOffset, targetW, targetH);
            yOffset += targetH + 45; 
        });

        stripCtx.fillStyle = "#222222";
        stripCtx.font = "bold 32px sans-serif";
        stripCtx.textAlign = "center";
        stripCtx.fillText("PHOTOVAR", stripCanvas.width / 2, 1700);

        stripCtx.fillStyle = "#666666";
        stripCtx.font = "italic 20px sans-serif";
        stripCtx.fillText("yang jauh menjadi dekat", stripCanvas.width / 2, 1735);

        stripCanvas.style.display = "inline-block";
        btnDownload.style.display = "inline-block";
    }

    btnDownload.addEventListener('click', () => {
        const link = document.createElement('a');
        link.download = 'photovar-classic-strip.png';
        link.href = stripCanvas.toDataURL('image/png');
        link.click();
    });

    // Jalankan inisialisasi UI awal agar tombol Snap langsung aktif semenjak aplikasi dibuka
    updateControlUI();
}