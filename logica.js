// =====================================================================
// CalendarioLMU - logica.js (versión unificada Web / Netlify + Electron)
// =====================================================================

const defaultCSV = `Horario,Categoría,Evento,Autos,Pista
08:00,RS Bronce,Mañana Racing,GT3,Interlagos
10:30,RS Plata,Sprint Cup,P2/P3,Silverstone
14:00,RS Oro,Endurance,HY,Le Mans
18:30,RS Bronce,Tarde de Acción,GT3,Monza
20:45,RS Plata,Night Race,P2,Spa-Francorchamps
22:15,RS Oro,Midnight Challenge,HY/GT3,Nordschleife
23:59,RS Bronce,Cierre de jornada,P3,Suzuka`;

const carColors = {
    'gt3': 'bg-blue-600',
    'p2': 'bg-green-600',
    'p3': 'bg-purple-600',
    'hy': 'bg-orange-600',
    'default': 'bg-teal-600'
};

// ---------------------------------------------------------------------
// ALMACENAMIENTO PERSISTENTE
// ---------------------------------------------------------------------
const KEY_CSV = 'carreras_csv_data';
const KEY_NAME = 'carreras_csv_name';
const KEY_OFF = 'carreras_filtros_desmarcados';

const store = {
    cache: {},
    api: (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.storage) || null,

    async init() {
        try {
            [KEY_CSV, KEY_NAME, KEY_OFF].forEach(k => {
                const v = localStorage.getItem(k);
                if (v !== null) this.cache[k] = v;
            });
        } catch (e) {}
        if (this.api) {
            try {
                const data = await this.api.load();
                if (data && typeof data === 'object') Object.assign(this.cache, data);
            } catch (e) {}
        }
    },

    get(k) {
        return Object.prototype.hasOwnProperty.call(this.cache, k) ? this.cache[k] : null;
    },

    set(k, v) {
        this.cache[k] = v;
        try { localStorage.setItem(k, v); } catch (e) {}
        if (this.api) {
            try { this.api.save(this.cache); } catch (e) {}
        }
    }
};

// ---------------------------------------------------------------------
// Variables
// ---------------------------------------------------------------------
let csvFileInput, fileNameDisplay, carrerasContainer, noCarrerasMsg, relojEl, filtroCategoriaContainer;
let currentCSVData = defaultCSV;
let carrerasProgramadas = [];
let ultimoMinutoRender = -1;

function actualizarReloj() {
    if (!relojEl) return;
    const ahora = new Date();
    const h = String(ahora.getHours()).padStart(2, '0');
    const m = String(ahora.getMinutes()).padStart(2, '0');
    const s = String(ahora.getSeconds()).padStart(2, '0');
    relojEl.textContent = `${h}:${m}:${s}`;
}

function getCategoryStyles(categoria) {
    const cat = categoria.toLowerCase();
    if (cat.includes('bronce')) return 'bg-red-600 text-white border-red-500 shadow-[0_0_10px_rgba(220,38,38,0.5)]';
    if (cat.includes('plata')) return 'bg-slate-300 text-slate-900 border-slate-400 shadow-[0_0_10px_rgba(203,213,225,0.5)]';
    if (cat.includes('oro')) return 'bg-yellow-500 text-yellow-950 border-yellow-400 shadow-[0_0_10px_rgba(234,179,8,0.5)]';
    return 'bg-gray-700 text-white border-gray-600';
}

function getCarBadgesHTML(autosStr) {
    const autos = autosStr.split(/[\/,;-]+/).map(a => a.trim()).filter(a => a);
    return autos.map(auto => {
        const bgColor = carColors[auto.toLowerCase()] || carColors['default'];
        return `<span class="px-2 py-1 text-xs font-bold rounded ${bgColor} text-white shadow-sm">${auto}</span>`;
    }).join('');
}

function procesarCSV() {
    if (!currentCSVData) return;
    const textData = currentCSVData.replace(/^\uFEFF/, '').replace(/\r/g, '').trim();
    const lineas = textData.split('\n');
    carrerasProgramadas = [];
    if (lineas.length === 0) return;

    let delimiter = ',';
    const primerLinea = lineas[0];
    const countComas = (primerLinea.match(/,/g) || []).length;
    const countPuntoComa = (primerLinea.match(/;/g) || []).length;
    const countTabs = (primerLinea.match(/\t/g) || []).length;
    if (countPuntoComa > countComas && countPuntoComa > countTabs) delimiter = ';';
    else if (countTabs > countComas && countTabs > countPuntoComa) delimiter = '\t';

    const parseCSVLine = (line, delim) => {
        const cols = []; let inQuotes = false; let current = '';
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"') inQuotes = !inQuotes;
            else if (char === delim && !inQuotes) { cols.push(current); current = ''; }
            else { current += char; }
        }
        cols.push(current);
        return cols.map(c => {
            let val = c.trim();
            if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1).trim();
            return val;
        });
    };

    const normalizeStr = (str) => str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    const encabezados = parseCSVLine(lineas[0], delimiter).map(normalizeStr);

    const idxHorario = encabezados.findIndex(h => h.includes('horario') || h.includes('hora'));
    const idxCategoria = encabezados.findIndex(h => h.includes('categoria') || h.includes('clase'));
    const idxEvento = encabezados.findIndex(h => h.includes('evento'));
    const idxAutos = encabezados.findIndex(h => h.includes('auto') || h.includes('coche') || h.includes('vehiculo'));
    const idxPista = encabezados.findIndex(h => h.includes('pista') || h.includes('circuito'));

    for (let i = 1; i < lineas.length; i++) {
        if (!lineas[i].trim()) continue;
        const cols = parseCSVLine(lineas[i], delimiter);
        const colHorario = idxHorario !== -1 ? idxHorario : 0;
        const horarioStr = cols[colHorario] || '';
        const matchHora = horarioStr.match(/(\d{1,2})[:.](\d{2})/);
        if (!matchHora) continue;

        const horas = parseInt(matchHora[1], 10);
        const minutos = parseInt(matchHora[2], 10);

        carrerasProgramadas.push({
            horarioOriginal: `${String(horas).padStart(2, '0')}:${String(minutos).padStart(2, '0')}`,
            minutosTotales: (horas * 60) + minutos,
            categoria: idxCategoria !== -1 ? (cols[idxCategoria] || '') : (cols[1] || ''),
            evento: idxEvento !== -1 ? (cols[idxEvento] || '') : (cols[2] || ''),
            autos: idxAutos !== -1 ? (cols[idxAutos] || '') : (cols[3] || ''),
            pista: idxPista !== -1 ? (cols[idxPista] || '') : (cols[4] || '')
        });
    }

    carrerasProgramadas.sort((a, b) => a.minutosTotales - b.minutosTotales);
    actualizarFiltros();
    mostrarCarreras();
}

// ---------------------------------------------------------------------
// FILTROS
// ---------------------------------------------------------------------
function guardarFiltrosActivos() {
    if (!filtroCategoriaContainer) return;
    const checkboxes = Array.from(filtroCategoriaContainer.querySelectorAll('input[type="checkbox"]'));
    if (checkboxes.length === 0) return;
    const desmarcadas = checkboxes.filter(cb => !cb.checked).map(cb => cb.value);
    store.set(KEY_OFF, JSON.stringify(desmarcadas));
}

function actualizarFiltros() {
    if (!filtroCategoriaContainer) return;

    let desmarcadas = [];
    try {
        const guardado = store.get(KEY_OFF);
        if (guardado) {
            const parseado = JSON.parse(guardado);
            if (Array.isArray(parseado)) desmarcadas = parseado;
        }
    } catch (e) {}

    const categoriasUnicas = [...new Set(carrerasProgramadas.map(c => c.categoria).filter(c => c))].sort();
    filtroCategoriaContainer.innerHTML = '';
    if (categoriasUnicas.length === 0) return;

    categoriasUnicas.forEach(cat => {
        const label = document.createElement('label');
        label.className = 'inline-flex items-center cursor-pointer bg-gray-900 border border-gray-700 rounded-lg px-2.5 py-1.5 hover:bg-gray-700 transition-colors shadow-sm';

        const inputEl = document.createElement('input');
        inputEl.type = 'checkbox';
        inputEl.value = cat;
        inputEl.className = 'form-checkbox h-4 w-4 text-blue-500 rounded border-gray-600 bg-gray-800 focus:ring-blue-500 focus:ring-offset-gray-900';
        inputEl.checked = !desmarcadas.includes(cat);

        inputEl.addEventListener('change', () => {
            guardarFiltrosActivos();
            mostrarCarreras();
        });

        const spanEl = document.createElement('span');
        spanEl.className = 'ml-2 text-sm text-gray-300 font-medium';
        spanEl.textContent = cat;

        label.appendChild(inputEl);
        label.appendChild(spanEl);
        filtroCategoriaContainer.appendChild(label);
    });
}

function mostrarCarreras() {
    if (!carrerasContainer || !noCarrerasMsg || !filtroCategoriaContainer) return;
    carrerasContainer.innerHTML = '';

    const ahora = new Date();
    const minutosActuales = (ahora.getHours() * 60) + ahora.getMinutes();
    ultimoMinutoRender = minutosActuales;

    let proximasCarreras = carrerasProgramadas.filter(c => c.minutosTotales >= minutosActuales);

    const todos = filtroCategoriaContainer.querySelectorAll('input[type="checkbox"]');
    const marcadas = Array.from(todos).filter(cb => cb.checked).map(cb => cb.value);

    if (todos.length > 0) {
        proximasCarreras = proximasCarreras.filter(c => marcadas.includes(c.categoria));
    }

    if (proximasCarreras.length === 0) {
        carrerasContainer.classList.add('hidden');
        noCarrerasMsg.classList.remove('hidden');
        noCarrerasMsg.classList.add('flex');
        return;
    }
    carrerasContainer.classList.remove('hidden');
    noCarrerasMsg.classList.add('hidden');
    noCarrerasMsg.classList.remove('flex');

    proximasCarreras.forEach((carrera, index) => {
        const isNext = index === 0;
        const ringClass = isNext
            ? 'ring-2 ring-blue-500 transform scale-[1.02] transition-transform'
            : 'border border-gray-700 hover:border-gray-500 transition-colors';

        const card = document.createElement('div');
        card.className = `bg-gray-800 rounded-xl p-5 shadow-lg flex flex-col justify-between ${ringClass}`;

        card.innerHTML = `
            <div class="flex justify-between items-start mb-4">
                <div class="flex items-center gap-3">
                    <span class="text-3xl font-black text-white bg-gray-900 px-3 py-1 rounded-lg border border-gray-700">
                        ${carrera.horarioOriginal}
                    </span>
                    ${isNext ? '<span class="flex h-3 w-3 relative"><span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span><span class="relative inline-flex rounded-full h-3 w-3 bg-blue-500"></span></span>' : ''}
                </div>
                <span class="px-3 py-1 text-sm font-bold rounded-full border ${getCategoryStyles(carrera.categoria)}">
                    ${carrera.categoria}
                </span>
            </div>

            <div class="mb-4">
                <h3 class="text-xl font-bold text-gray-100">${carrera.evento}</h3>
                <p class="text-gray-400 flex items-center gap-2 mt-2 bg-gray-900/50 p-2 rounded-lg border border-gray-700/50">
                    <svg class="w-5 h-5 text-emerald-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                    <span class="font-semibold text-gray-300">Pista:</span>
                    <span class="truncate" title="${carrera.pista}">${carrera.pista}</span>
                </p>
            </div>

            <div class="pt-4 border-t border-gray-700 flex flex-wrap items-center gap-2">
                <span class="text-xs text-gray-500 uppercase tracking-wider font-semibold mr-1">Autos:</span>
                ${getCarBadgesHTML(carrera.autos)}
            </div>
        `;
        carrerasContainer.appendChild(card);
    });
}

// ---------------------------------------------------------------------
// INICIO
// ---------------------------------------------------------------------
async function initApp() {
    csvFileInput = document.getElementById('csvFileInput');
    fileNameDisplay = document.getElementById('fileNameDisplay');
    carrerasContainer = document.getElementById('carrerasContainer');
    noCarrerasMsg = document.getElementById('noCarrerasMsg');
    relojEl = document.getElementById('reloj');
    filtroCategoriaContainer = document.getElementById('filtroCategoriaContainer');

    actualizarReloj();
    document.title = 'Horario de Carreras SimRacing v2';

    await store.init();

    // 1. Descargar automáticamente el CSV alojado en Netlify
    const archivoServidor = 'calendario_carreras_lmu_24hs.csv';
    let cargoDesdeServidor = false;

    try {
        const response = await fetch(`./${archivoServidor}?t=${Date.now()}`);
        if (response.ok) {
            const textoCSV = await response.text();
            if (textoCSV && textoCSV.trim().length > 0 && !textoCSV.trim().startsWith('<!DOCTYPE')) {
                currentCSVData = textoCSV;
                cargoDesdeServidor = true;
                if (fileNameDisplay) {
                    fileNameDisplay.textContent = archivoServidor;
                    fileNameDisplay.title = archivoServidor;
                }
            }
        }
    } catch (e) {
        console.warn('No se encontró CSV en servidor, usando respaldo local.', e);
    }

    // 2. Respaldo local (si se abre en Electron o falla la red)
    if (!cargoDesdeServidor) {
        const localData = store.get(KEY_CSV);
        const localName = store.get(KEY_NAME);
        if (localData && localName) {
            currentCSVData = localData;
            if (fileNameDisplay) {
                fileNameDisplay.textContent = localName;
                fileNameDisplay.title = localName;
            }
        }
    }

    procesarCSV();

    if (csvFileInput) {
        csvFileInput.addEventListener('change', function (e) {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = function (evento) {
                currentCSVData = evento.target.result;
                fileNameDisplay.textContent = file.name;
                fileNameDisplay.title = file.name;
                store.set(KEY_CSV, currentCSVData);
                store.set(KEY_NAME, file.name);
                procesarCSV();
            };
            reader.readAsText(file);
            e.target.value = '';
        });
    }

    setInterval(() => {
        actualizarReloj();
        const ahora = new Date();
        const minutoActual = (ahora.getHours() * 60) + ahora.getMinutes();
        if (minutoActual !== ultimoMinutoRender) mostrarCarreras();
    }, 1000);

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) { actualizarReloj(); mostrarCarreras(); }
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}