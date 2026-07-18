document.addEventListener('DOMContentLoaded', () => {
    // Jalankan kode hanya setelah semua elemen HTML dan Library eksternal selesai dimuat browser
    initApp();
});

function initApp() {
    // State & Variabel Global
    let peer;
    let dataConn; 
    let currentCall; 
    let localStream;
    let hasControl = true;
    let isCapturing = false;
    let capturedPhotos = [];

    // DOM Elements
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

    // Cek ketersediaan library MediaPipe secara aman
    if (typeof SelfieSegmentation === 'undefined') {
        console.error("Library MediaPipe SelfieSegmentation gagal dimuat. Cek koneksi internet atau tag script.");
        connectionStatus.innerText = "Error: Gagal memuat AI Library.";
        return;
    }

    // ==========================================
    // FUNGSI GENERATE ID 8 DIGIT ACAK
    // ==========================================
    function generateShortId(length = 8) {
        const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        for (let i = 0; i < length; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }

    // ==========================================
    // 1. MEDIAPIPE AI SETUP
    // ==========================================
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

    // ==========================================
    // 2. MAIN COMPOSITING (RERENDER AMAN)
    // ==========================================
    function drawCompositeStage() {
        ctxComposite.clearRect(0, 0, canvasComposite.width, canvasComposite.height);
        
        const orangW = 640;
        const orangH = 480;
        const paddingBawah = 0; 

        // Render Kamera Lokal (Selalu Digambar di Sisi Kiri jika stream aktif)
        if (localStream) {
            const xLokal = 0 + (canvasComposite.width / 2 - orangW) / 2 + 100; 
            const yLokal = canvasComposite.height - orangH - paddingBawah;
            ctxComposite.drawImage(canvasLocal, xLokal, yLokal, orangW, orangH);
        }

        // Render Kamera Remote (Hanya Digambar di Sisi Kanan jika ada stream masuk)
        if (videoRemote.srcObject && !videoRemote.paused) {
            const xRemote = canvasComposite.width / 2 + (canvasComposite.width / 2 - orangW) / 2 - 100; 
            const yRemote = canvasComposite.height - orangH - paddingBawah;
            ctxComposite.drawImage(canvasRemote, xRemote, yRemote, orangW, orangH);
        }

        requestAnimationFrame(drawCompositeStage);
    }

    // Akses Kamera Lokal
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
            // Jalankan looping panggung
            drawCompositeStage();
        })
        .catch(err => {
            console.error("Akses kamera gagal:", err);
            alert("Harap izinkan akses kamera pada browser Anda!");
        });


    // ==========================================
    // 3. NETWORK KONEKSI PEERJS (ID 8 DIGIT)
    // ==========================================
    const customId = generateShortId(8);
    peer = new Peer(customId); 

    peer.on('open', (id) => {
        document.getElementById('my-id').innerText = id;
    });

    peer.on('error', (err) => {
        console.error("PeerJS Error:", err);
        connectionStatus.innerText = "Koneksi terputus/gagal.";
    });

    // Menangani Panggilan Video Masuk
    peer.on('call', (call) => {
        connectionStatus.innerText = "Menerima panggilan video...";
        call.answer(localStream);
        handleCall(call);
    });

    // Menangani Sambungan Data Masuk
    peer.on('connection', (incomingDataConn) => {
        dataConn = incomingDataConn;
        setupDataListeners();
        connectionStatus.innerText = "Terhubung dengan device remote!";
        hasControl = false; 
        updateControlUI();
    });

    // Tombol Hubungkan/Panggil Teman
    btnCall.addEventListener('click', () => {
        const peerId = peerIdInput.value.trim().toLowerCase();
        if (peerId.length !== 8) return alert("Masukkan ID teman yang valid (8 Karakter)!");
        
        connectionStatus.innerText = "Memanggil device teman...";
        
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
                connectionStatus.innerText = "Kalian berdua satu panggung!";
                async function detectionFrameRemote() {
                    if (!videoRemote.paused && !videoRemote.ended) {
                        await aiRemote.send({ image: videoRemote });
                    }
                    requestAnimationFrame(detectionFrameRemote);
                }
                detectionFrameRemote();
            });
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
    }

    function updateControlUI() {
        currentControllerText.innerText = hasControl ? "Lokal (Anda)" : "Teman Anda (Jarak Jauh)";
        btnSnap.disabled = !hasControl;
        btnPass.disabled = !hasControl;
    }

    btnPass.addEventListener('click', () => {
        if (!dataConn) return;
        hasControl = false;
        updateControlUI();
        dataConn.send({ type: 'PASS_CONTROL' });
    });


    // ==========================================
    // 4. SHUTTER & CARD GENERATOR
    // ==========================================
    btnSnap.addEventListener('click', () => {
        if (!hasControl || !dataConn) return alert("Pastikan sudah terhubung penuh dengan device teman.");
        dataConn.send({ type: 'START_SHOOT' }); 
        runShootSequence();
    });

    function runShootSequence() {
        if (isCapturing) return;
        isCapturing = true;
        capturedPhotos = [];
        let photoCount = 0;
        
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
        
        const xOffset = 20; 
        let yOffset = 40;  
        const targetW = 400; 
        const targetH = 225; 

        capturedPhotos.forEach((photo) => {
            stripCtx.fillStyle = "rgba(255, 255, 255, 0.05)";
            stripCtx.fillRect(xOffset, yOffset, targetW, targetH);
            stripCtx.drawImage(photo, xOffset, yOffset, targetW, targetH);
            yOffset += targetH + 30; 
        });

        stripCanvas.style.display = "inline-block";
        btnDownload.style.display = "inline-block";
    }

    btnDownload.addEventListener('click', () => {
        const link = document.createElement('a');
        link.download = 'photobooth-berdua-transparan.png';
        link.href = stripCanvas.toDataURL('image/png');
        link.click();
    });
}
