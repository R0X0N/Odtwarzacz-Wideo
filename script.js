const video = document.getElementById('videoPlayer');
const uploader = document.getElementById('videoUploader');
const fileInfo = document.getElementById('fileInfo');
const playBtn = document.getElementById('playBtn');
const timeLabel = document.getElementById('timeLabel');
const trimLabel = document.getElementById('trimLabel');
const rangesList = document.getElementById('rangesList');
const actionRangeBtn = document.getElementById('actionRangeBtn');
const cancelEditBtn = document.getElementById('cancelEditBtn');

// Bootstrap Modal Elements
const nameModalEl = document.getElementById('nameModal');
const nameModal = new bootstrap.Modal(nameModalEl);
const modalInput = document.getElementById('modalInput');
const modalSaveBtn = document.getElementById('modalSaveBtn');
let modalCallback = null; 

// Zmienne metadanych
let originalFileName = "Wideo";
let fps = 30.0;
let totalFrames = 1;
let currentFrame = 0;
let trimStart = 0;
let trimEnd = 0;
let selectedRanges = [];
let editingRangeId = null;

// Oś czasu Canvas
const canvas = document.getElementById('timelineCanvas');
const ctx = canvas.getContext('2d');
let dragging = null;
const margin = 20;

// --- ŁADOWANIE I ANALIZA WIDEO ---
uploader.addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;

    // Resetowanie danych przy nowym pliku
    originalFileName = file.name.replace(/\.[^/.]+$/, "");
    selectedRanges = [];
    editingRangeId = null;
    updateRangesList();
    cancelEdit();
    video.pause();

    // Sprawdzanie czy to plik MKV
    const isMKV = file.name.toLowerCase().endsWith('.mkv') || file.type === 'video/x-matroska';

    if (isMKV) {
        // MKV - Przechodzimy w tryb wbudowany przeglądarki
        fileInfo.textContent = "Analizowanie MKV...";
        fileInfo.style.color = "#FDD835";
        
        // Pytamy użytkownika o FPS, ponieważ z pliku MKV nie da się tego łatwo wyciągnąć bez FFmpeg
        let userFpsInput = prompt("Wgrywasz plik MKV.\nPrzeglądarka nie potrafi automatycznie odczytać ilości klatek na sekundę (FPS) z tego formatu.\n\nPodaj wartość FPS dla tego filmu (np. 24, 25, 30, 60):", "30");
        let parsedFps = parseFloat(userFpsInput);
        if (isNaN(parsedFps) || parsedFps <= 0) parsedFps = 30.0; // Domyślnie 30 jeśli ktoś wpisze głupoty

        fallbackInit(file, "Pominięto MP4Box dla pliku MKV", parsedFps);
    } else {
        // MP4 - Standardowa, dokładna ścieżka
        fileInfo.textContent = "Analizowanie pliku (MP4Box)...";
        fileInfo.style.color = "#FDD835";
        analyzeWithMP4Box(file);
    }
});

function analyzeWithMP4Box(file) {
    const mp4boxfile = MP4Box.createFile();

    mp4boxfile.onReady = function(info) {
        const videoTrack = info.videoTracks[0];
        if (videoTrack) {
            const durationSeconds = videoTrack.duration / videoTrack.timescale;
            const frameCount = videoTrack.nb_samples;
            const detectedFps = frameCount / durationSeconds;
            console.log(`[MP4Box] Wykryto: ${detectedFps.toFixed(2)} FPS, ${frameCount} klatek.`);
            initializeVideoState(file, detectedFps, frameCount);
        } else {
            fallbackInit(file, "Brak ścieżki wideo w metadanych MP4", 30.0);
        }
    };

    mp4boxfile.onError = function(e) {
        console.error("MP4Box Error:", e);
        fallbackInit(file, "Błąd parsowania MP4Box", 30.0);
    };

    const reader = new FileReader();
    let offset = 0;
    const bufferSize = 1024 * 1024; // 1MB

    reader.onload = function(e) {
        const buffer = e.target.result;
        buffer.fileStart = offset;
        mp4boxfile.appendBuffer(buffer);
        offset += buffer.byteLength;
        if (offset < file.size) {
            const slice = file.slice(offset, offset + bufferSize);
            reader.readAsArrayBuffer(slice);
        } else {
            mp4boxfile.flush();
        }
    };

    const slice = file.slice(0, bufferSize);
    reader.readAsArrayBuffer(slice);
}

function fallbackInit(file, reason, assumedFps) {
    console.warn(`[FALLBACK] Powód: ${reason}. Założono: ${assumedFps} FPS`);
    
    const tempVideo = document.createElement('video');
    tempVideo.src = URL.createObjectURL(file);
    
    tempVideo.onloadedmetadata = () => {
        const duration = tempVideo.duration;
        if (!isFinite(duration)) {
            fileInfo.textContent = "Błąd: Przeglądarka nie może ustalić długości pliku MKV.";
            fileInfo.style.color = "#E53935";
            URL.revokeObjectURL(tempVideo.src);
            return;
        }
        
        initializeVideoState(file, assumedFps, Math.round(duration * assumedFps));
        URL.revokeObjectURL(tempVideo.src);
    };

    tempVideo.onerror = () => {
        fileInfo.textContent = "Błąd: Przeglądarka nie obsługuje kodeka z tego pliku MKV (spróbuj H.264).";
        fileInfo.style.color = "#E53935";
        URL.revokeObjectURL(tempVideo.src);
    };
}

function initializeVideoState(file, detectedFps, detectedFrames) {
    fps = detectedFps;
    totalFrames = detectedFrames > 0 ? detectedFrames : 1;
    
    const existingUrl = video.src;
    if (existingUrl) URL.revokeObjectURL(existingUrl);

    video.src = URL.createObjectURL(file);
    video.load();
    
    video.onloadedmetadata = () => {
        if (detectedFrames <= 0) {
            totalFrames = Math.round(video.duration * fps);
        }
        
        fileInfo.textContent = `FPS: ${fps.toFixed(2)} | Klatek: ${totalFrames}`;
        fileInfo.style.color = "#A3BE8C";
        
        trimStart = 0;
        trimEnd = totalFrames - 1;
        currentFrame = 0;
        
        // POPRAWKA: Opóźnienie renderowania osi czasu, aby CSS zdążył przydzielić wymiary
        setTimeout(() => {
            resizeTimeline();
            updateLabels();
            syncVideoToFrame();
        }, 150);
    };
}

// --- MODAL LOGIC ---
function openNameModal(title, initialValue, callback) {
    document.getElementById('nameModalLabel').textContent = title;
    modalInput.value = initialValue;
    modalCallback = callback;
    nameModal.show();
    setTimeout(() => modalInput.focus(), 500);
}

modalSaveBtn.onclick = () => {
    const val = modalInput.value.trim().replace(/[^a-zA-Z0-9ąćęłńóśźżĄĆĘŁŃÓŚŹŻ_-]/g, '_');
    if (val && modalCallback) modalCallback(val);
    nameModal.hide();
};

modalInput.onkeydown = (e) => { 
    if (e.key === 'Enter') {
        e.preventDefault();
        modalSaveBtn.click();
    }
};

// --- OBSŁUGA KLAWIATURY ---
window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    const key = e.key.toLowerCase();
    
    if (key === 'i') setInPoint();
    if (key === 'o') setOutPoint();
    
    if (e.code === 'Space') {
        e.preventDefault(); 
        togglePlay();
    }
    
    if (e.code === 'ArrowLeft') {
        e.preventDefault();
        skipFrames(-1);
    }
    if (e.code === 'ArrowRight') {
        e.preventDefault();
        skipFrames(1);
    }
});

// --- RYSOWANIE OSI CZASU ---
window.addEventListener('resize', resizeTimeline);
function resizeTimeline() {
    if (!canvas.parentElement) return;
    canvas.width = canvas.parentElement.clientWidth;
    canvas.height = canvas.parentElement.clientHeight;
    drawTimeline();
}

function frameToX(frame) {
    if (totalFrames <= 1) return margin;
    const usableWidth = canvas.width - 2 * margin;
    return margin + (frame / (totalFrames - 1)) * usableWidth;
}

function xToFrame(x) {
    if (totalFrames <= 1) return 0;
    const usableWidth = canvas.width - 2 * margin;
    let ratio = (x - margin) / usableWidth;
    ratio = Math.max(0.0, Math.min(1.0, ratio));
    return Math.round(ratio * (totalFrames - 1));
}

function drawRoundedRect(ctx, x, y, w, h, r, color) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.fillStyle = color; ctx.fill(); ctx.closePath();
}

function drawTimeline() {
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const track_h = 48;
    const track_y = Math.floor(canvas.height / 2 - track_h / 2 + 5);
    const x_start = frameToX(trimStart), x_end = frameToX(trimEnd), x_curr = frameToX(currentFrame);
    
    drawRoundedRect(ctx, margin, track_y, canvas.width - 2 * margin, track_h, 8, "#16181A");
    
    const width = Math.max(2, x_end - x_start);
    const rangeColor = editingRangeId ? "#FDD835" : "#2E7D32"; 
    drawRoundedRect(ctx, x_start, track_y, width, track_h, 8, rangeColor);
    
    const handle_w = 16;
    drawRoundedRect(ctx, x_start - handle_w / 2, track_y - 4, handle_w, track_h + 8, 6, "#8EB2D6");
    drawRoundedRect(ctx, x_end - handle_w / 2, track_y - 4, handle_w, track_h + 8, 6, "#8EB2D6");
    
    ctx.beginPath(); ctx.strokeStyle = "#E53935"; ctx.lineWidth = 2;
    ctx.moveTo(x_curr, track_y - 15); ctx.lineTo(x_curr, track_y + track_h + 15); ctx.stroke();
    ctx.beginPath(); ctx.fillStyle = "#E53935";
    ctx.moveTo(x_curr - 9, track_y - 15); ctx.lineTo(x_curr + 9, track_y - 15); ctx.lineTo(x_curr, track_y);
    ctx.fill();
}

canvas.addEventListener('mousedown', (e) => {
    if (totalFrames <= 1) return;
    const x = e.clientX - canvas.getBoundingClientRect().left;
    const x_curr = frameToX(currentFrame), x_start = frameToX(trimStart), x_end = frameToX(trimEnd);
    const handleThreshold = 18;
    
    if (Math.abs(x - x_start) < handleThreshold) dragging = 'start';
    else if (Math.abs(x - x_end) < handleThreshold) dragging = 'end';
    else if (Math.abs(x - x_curr) < handleThreshold) dragging = 'playhead';
    else { 
        dragging = 'playhead'; 
        currentFrame = xToFrame(x); 
        syncVideoToFrame(); 
    }
});

window.addEventListener('mousemove', (e) => {
    if (!dragging || totalFrames <= 1) return;
    let frame = xToFrame(e.clientX - canvas.getBoundingClientRect().left);
    if (dragging === 'playhead') { currentFrame = frame; syncVideoToFrame(); }
    else if (dragging === 'start') { if (frame > trimEnd) frame = trimEnd; trimStart = frame; drawTimeline(); updateLabels(); }
    else if (dragging === 'end') { if (frame < trimStart) frame = trimStart; trimEnd = frame; drawTimeline(); updateLabels(); }
});

window.addEventListener('mouseup', () => dragging = null);

// --- KONTROLA WIDEO ---
function syncVideoToFrame() {
    if (!video.src || isNaN(fps) || fps <= 0) return;
    video.currentTime = currentFrame / fps;
    drawTimeline(); updateLabels();
}

function togglePlay() {
    if (!video.src) return alert("Wgraj wideo!");
    if (video.paused) { video.play(); playBtn.textContent = '||'; playBtn.classList.add('playing'); }
    else { video.pause(); playBtn.textContent = '▶'; playBtn.classList.remove('playing'); }
}

function skipFrames(offset) {
    if (!video.src) return;
    currentFrame = Math.max(0, Math.min(totalFrames - 1, currentFrame + offset));
    syncVideoToFrame();
}

video.addEventListener('timeupdate', () => {
    if (dragging !== 'playhead' && !video.paused) {
        const newFrame = Math.round(video.currentTime * fps);
        if (newFrame !== currentFrame) {
            currentFrame = newFrame;
            drawTimeline(); 
            updateLabels();
        }
    }
});

function setInPoint() { if (currentFrame <= trimEnd) { trimStart = currentFrame; drawTimeline(); updateLabels(); } }
function setOutPoint() { if (currentFrame >= trimStart) { trimEnd = currentFrame; drawTimeline(); updateLabels(); } }

function formatTime(frame) {
    const totalSecs = frame / fps;
    if (isNaN(totalSecs)) return "00:00.00";
    const m = Math.floor(totalSecs / 60).toString().padStart(2, '0');
    const s = Math.floor(totalSecs % 60).toString().padStart(2, '0');
    const ms = Math.floor((totalSecs % 1) * 100).toString().padStart(2, '0');
    return `${m}:${s}.${ms}`;
}

function updateLabels() {
    timeLabel.textContent = `${formatTime(currentFrame)} / ${formatTime(totalFrames)}`;
    trimLabel.textContent = `Klatka: ${currentFrame} | Docinanie: ${trimStart} - ${trimEnd}`;
}

// --- ZARZĄDZANIE ZAKRESAMI ---
function renameRange(id) {
    const r = selectedRanges.find(x => x.id === id);
    if (!r) return;
    openNameModal("Zmień nazwę ujęcia", r.name, (newName) => {
        r.name = newName;
        updateRangesList();
    });
}

function handleRangeAction() {
    if (!video.src) return alert("Najpierw wgraj plik wideo!");
    
    if (editingRangeId !== null) {
        const r = selectedRanges.find(x => x.id === editingRangeId);
        if (r) { r.start = trimStart; r.end = trimEnd; }
        cancelEdit();
        updateRangesList();
    } else {
        openNameModal("Dodaj nowy zakres", `Ujecie_${selectedRanges.length + 1}`, (name) => {
            selectedRanges.push({
                id: Date.now(),
                name: name,
                start: trimStart,
                end: trimEnd
            });
            updateRangesList();
            trimStart = 0;
            trimEnd = totalFrames - 1;
            drawTimeline();
            updateLabels();
        });
    }
}

function editRange(id) {
    const r = selectedRanges.find(x => x.id === id);
    if (!r) return;

    editingRangeId = id;
    trimStart = r.start; 
    trimEnd = r.end; 
    currentFrame = r.start;

    syncVideoToFrame();

    actionRangeBtn.textContent = "Zapisz zmiany ✔️";
    actionRangeBtn.classList.add("editing");
    if (cancelEditBtn) cancelEditBtn.style.display = "inline-block";
}

function cancelEdit() {
    editingRangeId = null;
    actionRangeBtn.textContent = "Dodaj zakres ➕";
    actionRangeBtn.classList.remove("editing");
    if (cancelEditBtn) cancelEditBtn.style.display = "none";
    
    if(totalFrames > 1) {
        trimStart = 0; 
        trimEnd = totalFrames - 1;
        drawTimeline(); 
        updateLabels();
    }
}

function deleteRange(id) {
    if (editingRangeId === id) cancelEdit();
    selectedRanges = selectedRanges.filter(r => r.id !== id);
    updateRangesList();
}

function updateRangesList() {
    rangesList.innerHTML = '';
    selectedRanges.forEach(r => {
        rangesList.innerHTML += `
            <div class="region-item">
                <div class="region-details" onclick="renameRange(${r.id})" style="cursor:pointer">
                    <span class="region-name">${r.name} ✏️</span>
                    <span class="region-frames">Klatki: ${r.start} - ${r.end}</span>
                </div>
                <div class="d-flex gap-1">
                    <button class="btn btn-sm btn-edit" onclick="editRange(${r.id})">Edytuj</button>
                    <button class="btn btn-sm btn-outline-danger" onclick="deleteRange(${r.id})">Usuń</button>
                </div>
            </div>`;
    });
}

// --- GENEROWANIE I BEZPOŚREDNI ZAPIS DO FOLDERÓW ---
async function processVideo() {
    if (!video.src) return alert("Najpierw wgraj plik wideo!");
    if (selectedRanges.length === 0) return alert("Dodaj co najmniej jeden zakres!");

    if (!window.showDirectoryPicker) {
        return alert("BŁĄD ZAPISU:\n\nTwoja przeglądarka blokuje bezpośredni zapis do folderu.\n\nPowody:\n1. Otworzyłeś ten plik dwukrotnym kliknięciem (ścieżka file:///). Użyj serwera lokalnego np. 'Live Server' w VS Code (adres http://localhost).\n2. Używasz Firefoksa. Zmień na Chrome, Edge lub Brave.");
    }

    const btn = document.getElementById('processBtn');
    
    let baseDirHandle;
    try {
        baseDirHandle = await window.showDirectoryPicker({
            mode: 'readwrite'
        });
    } catch (err) {
        if (err.name === 'AbortError') return; 
        console.error(err);
        return alert("BŁĄD ZAPISU:\n\nPrzeglądarka ze względów bezpieczeństwa blokuje zapis w głównych folderach systemowych (np. bezpośrednio na dysku C:\\ lub w głównym folderze Użytkownika).\n\nROZWIĄZANIE:\nStwórz NOWY, PUSTY FOLDER (np. na Pulpicie), wejdź do niego i dopiero wtedy kliknij 'Wybierz folder'.");
    }

    const step = parseInt(document.getElementById('frameStep').value) || 1;
    const overlay = document.getElementById('processingOverlay');
    const percentText = document.getElementById('percentText');
    const progressText = document.getElementById('progressText');
    const etaText = document.getElementById('etaText');
    
    video.pause();
    btn.disabled = true;
    btn.textContent = "Zapisywanie...";

    const frameMap = new Map();
    selectedRanges.forEach(r => { 
        for (let f = r.start; f <= r.end; f += step) {
            if (!frameMap.has(f)) frameMap.set(f, []);
            frameMap.get(f).push(r.name); 
        }
    });

    const uniqueFrames = Array.from(frameMap.keys()).sort((a, b) => a - b);
    const totalUniqueFrames = uniqueFrames.length;

    overlay.style.display = 'flex';
    percentText.textContent = "0%";
    progressText.textContent = `0 / ${totalUniqueFrames} unikalnych klatek`;
    etaText.textContent = `Szacowany czas: --:--`;

    const now = new Date();
    const dateStr = `${now.getFullYear()}-${(now.getMonth()+1).toString().padStart(2,'0')}-${now.getDate().toString().padStart(2,'0')}_${now.getHours().toString().padStart(2,'0')}-${now.getMinutes().toString().padStart(2,'0')}`;
    const mainFolderName = `${originalFileName}_klatki_${dateStr}`;
    
    const mainDirHandle = await baseDirHandle.getDirectoryHandle(mainFolderName, { create: true });

    const shotFolderHandles = {};
    for (const r of selectedRanges) { 
        shotFolderHandles[r.name] = await mainDirHandle.getDirectoryHandle(r.name, { create: true }); 
    }

    const jsonData = {
        plikWideo: originalFileName,
        dataWygenerowania: new Date().toLocaleString('pl-PL'),
        fps: fps,
        zakresy: selectedRanges.map(r => ({
            nazwa: r.name,
            start_frame: r.start,
            end_frame: r.end,
            start_time: formatTime(r.start),
            end_time: formatTime(r.end)
        }))
    };
    
    const jsonFileHandle = await mainDirHandle.getFileHandle("informacje_o_ujeciach.json", { create: true });
    const writableJson = await jsonFileHandle.createWritable();
    await writableJson.write(JSON.stringify(jsonData, null, 4));
    await writableJson.close();

    const offscreenCanvas = document.createElement('canvas');
    const offscreenCtx = offscreenCanvas.getContext('2d');
    offscreenCanvas.width = video.videoWidth; 
    offscreenCanvas.height = video.videoHeight;

    const seekVideo = (time) => {
        return new Promise(resolve => {
            let resolved = false;
            const onSeeked = () => {
                if(resolved) return;
                resolved = true;
                video.removeEventListener('seeked', onSeeked);
                resolve();
            };
            video.addEventListener('seeked', onSeeked);
            video.currentTime = time;
            setTimeout(() => {
                if(!resolved) {
                    resolved = true;
                    video.removeEventListener('seeked', onSeeked);
                    resolve();
                }
            }, 1000); 
        });
    };

    let framesProcessed = 0;
    const startTime = Date.now();

    for (const f of uniqueFrames) {
        if (video.currentTime.toFixed(5) !== (f / fps).toFixed(5)) {
            await seekVideo(f / fps);
        }
        
        offscreenCtx.drawImage(video, 0, 0, offscreenCanvas.width, offscreenCanvas.height);
        
        const blob = await new Promise(resolve => offscreenCanvas.toBlob(resolve, 'image/jpeg', 0.90));
        
        const targetFolders = frameMap.get(f);
        
        const writePromises = targetFolders.map(async (folderName) => {
            const folderHandle = shotFolderHandles[folderName];
            const fileName = `frame_${f.toString().padStart(6, '0')}.jpg`;
            
            const fileHandle = await folderHandle.getFileHandle(fileName, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(blob); 
            await writable.close();
        });
        
        await Promise.all(writePromises);
        
        framesProcessed++;
        percentText.textContent = `${Math.round((framesProcessed / totalUniqueFrames) * 100)}%`;
        progressText.textContent = `${framesProcessed} / ${totalUniqueFrames} unikalnych klatek`;
        
        if (framesProcessed > 5) {
            const elapsed = Date.now() - startTime;
            const timePerFrame = elapsed / framesProcessed;
            const etaSeconds = Math.round((timePerFrame * (totalUniqueFrames - framesProcessed)) / 1000);
            const minutes = Math.floor(etaSeconds / 60);
            const seconds = (etaSeconds % 60).toString().padStart(2, '0');
            etaText.textContent = `Szacowany czas: ${minutes}:${seconds}`;
        }
    }

    etaText.textContent = "Zapisano pomyślnie!";
    
    setTimeout(() => {
        overlay.style.display = 'none';
        btn.disabled = false;
        btn.textContent = "Wybierz folder i Zapisz (Zoptymalizowane)";
    }, 1500);
}
