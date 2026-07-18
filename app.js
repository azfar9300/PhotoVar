// State & Variabel Global
let peer;
let conn;
let hasControl = true; 
let capturedPhotos = [];
let isCapturing = false;

// DOM Elements
const video = document.getElementById('webcam');
const outCanvas = document.getElementById('output-canvas');
const ctx = outCanvas.getContext('2d');
const stripCanvas = document.getElementById('photos-strip');
const stripCtx = stripCanvas.getContext('2d');

const btnConnect = document.getElementById('btn-connect');
const btnSnap = document.getElementById('btn-snap');
const btnPass = document.getElementById('btn-pass');
const btnDownload = document.getElementById('btn-download');

const peerIdInput = document.getElementById('peer-id-input');
const connectionStatus = document.getElementById('connection-status');
const currentControllerText = document.getElementById('current-controller');
const countdownEl = document.getElementById('countdown');

// ==========================================
// 1. INITIALIZE MEDIAPIPE AI BACKGROUND REMOVAL
// ==========================================
const selfieSegmentation = new SelfieSegmentation({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`
});
selfieSegmentation.setOptions({ modelSelection: 1 }); // 1 = model lanskap/lebih detail
selfieSegmentation.onResults(onSegmentationResults);

function onSegmentationResults(results) {
    ctx.save();
    ctx.clearRect(0, 0, outCanvas.width, outCanvas.height);
    
    // Gambar topeng/mask dari AI terlebih dahulu
    ctx.drawImage(results.segmentationMask, 0, 0, outCanvas.width, outCanvas.height);
    
    // Trik Canvas Composite: Hanya potong & gambar video di dalam area topeng manusia
    ctx.globalCompositeOperation = 'source-in';
    ctx.drawImage(results.image, 0, 0, outCanvas.width, outCanvas.height);
    ctx.restore();
}

// Buka Kamera Device
navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } })
    .then(stream => {
        video.srcObject = stream;
        video.addEventListener('playing', () => {
            async function detectionFrame() {
                if (!video.paused && !video.ended) {
                    await selfieSegmentation.send({ image: video });
                }
                requestAnimationFrame(detectionFrame);
            }
            detectionFrame();
        });
    })
    .catch(err => alert("Gagal mengakses kamera: " + err));


// ==========================================
// 2. NETWORK CONNECTION LOGIC (PEERJS)
// ==========================================
peer = new Peer(); // Menggunakan public cloud server broker gratis dari PeerJS

peer.on('open', (id) => {
    document.getElementById('my-id').innerText = id;
});

// Menghandle device lain yang masuk duluan lewat ID kita
peer.on('connection', (incomingConn) => {
    conn = incomingConn;
    setupConnectionListeners();
    connectionStatus.innerText = "Terhubung dengan device jarak jauh!";
    hasControl = false; // Yang menerima sambungan mengalah dulu, kontrol dipegang pemanggil
    updateControlUI();
});

// Aksi tombol hubungkan manual ke device teman
btnConnect.addEventListener('click', () => {
    const peerId = peerIdInput.value.trim();
    if (!peerId) return alert("Masukkan ID teman terlebih dahulu!");
    
    conn = peer.connect(peerId);
    setupConnectionListeners();
    connectionStatus.innerText = "Mencoba terhubung...";
});

function setupConnectionListeners() {
    conn.on('open', () => {
        connectionStatus.innerText = "Terhubung dengan device jarak jauh!";
        hasControl = true; // Si pemanggil koneksi memegang kendali awal
        updateControlUI();
    });

    // Mendengarkan instruksi/data masuk dari device remote
    conn.on('data', (data) => {
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

// Mengoper hak kendali memicu jepretan foto
btnPass.addEventListener('click', () => {
    if (!conn) return;
    hasControl = false;
    updateControlUI();
    conn.send({ type: 'PASS_CONTROL' });
});


// ==========================================
// 3. PHOTO SHUTTER & COUNTDOWN SYSTEM
// ==========================================
btnSnap.addEventListener('click', () => {
    if (!hasControl) return;
    if (conn) conn.send({ type: 'START_SHOOT' }); // Suruh device sebelah ikut hitung mundur
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
                
                // Beri jeda sangat singkat agar user sadar flash jepretan berjalan
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
    // Manfaatkan canvas bayangan (offscreen) untuk freeze frame gambar transparan saat ini
    const memCanvas = document.createElement('canvas');
    memCanvas.width = outCanvas.width;
    memCanvas.height = outCanvas.height;
    const memCtx = memCanvas.getContext('2d');
    memCtx.drawImage(outCanvas, 0, 0);
    capturedPhotos.push(memCanvas);
}


// ==========================================
// 4. CANVAS CARD STITCHING & DOWNLOAD
// ==========================================
function generatePhotoboothCard() {
    if (capturedPhotos.length < 3) return;
    
    // Bersihkan canvas strip foto utama
    stripCtx.clearRect(0, 0, stripCanvas.width, stripCanvas.height);
    
    const targetW = 200;
    const targetH = 150;
    const xOffset = 20; // Margin kiri-kanan
    let yOffset = 30;  // Margin atas pertama

    capturedPhotos.forEach((photo) => {
        // Kotak bayangan latar belakang per foto (opsional, agar objek terlihat meskipun latar strip transparan)
        stripCtx.fillStyle = "rgba(255, 255, 255, 0.1)";
        stripCtx.fillRect(xOffset, yOffset, targetW, targetH);
        
        // Render objek transparan hasil tangkapan AI
        stripCtx.drawImage(photo, xOffset, yOffset, targetW, targetH);
        yOffset += targetH + 20; // Kasih space jarak antar foto ke bawah
    });

    // Tampilkan canvas hasil dan tombol unduh
    stripCanvas.style.display = "inline-block";
    btnDownload.style.display = "inline-block";
}

// Download hasil jadi PNG Transparan
btnDownload.addEventListener('click', () => {
    const link = document.createElement('a');
    link.download = 'online-photobooth-transparan.png';
    link.href = stripCanvas.toDataURL('image/png');
    link.click();
});