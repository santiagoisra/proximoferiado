document.addEventListener("DOMContentLoaded", function() {
    fetch('feriados.txt')
        .then(response => response.text())
        .then(data => {
            const feriados = parseFeriados(data);
            let hoy = moment.tz('America/Argentina/Buenos_Aires').startOf('day').toDate();
            let mesActual = hoy.getMonth();
            let añoActual = hoy.getFullYear();

            actualizarCalendarioYLista(mesActual, añoActual, feriados);
        })
        .catch(error => {
            console.error('Error al leer el archivo de feriados:', error);
        });
});

function mostrarCalendario(mes, año, feriados) {
    const calendario = document.getElementById("calendario");
    calendario.innerHTML = generarCalendario(mes, año, feriados);

    // Reasignar eventos a las flechas después de actualizar el calendario
    // Usamos selectores más específicos para asegurarnos de que estamos seleccionando las flechas del selector de mes
    const flechaIzquierda = calendario.querySelector('.selector-mes .arrow-left');
    const flechaDerecha = calendario.querySelector('.selector-mes .arrow-right');

    if (!flechaIzquierda || !flechaDerecha) {
        console.error("No se encontraron las flechas de navegación");
        return;
    }

    flechaIzquierda.addEventListener('click', function() {
        if (mes === 0) {
            mes = 11;
            año -= 1;
        } else {
            mes -= 1;
        }
        actualizarCalendarioYLista(mes, año, feriados);
    });

    flechaDerecha.addEventListener('click', function() {
        if (mes === 11) {
            mes = 0;
            año += 1;
        } else {
            mes += 1;
        }
        actualizarCalendarioYLista(mes, año, feriados);
    });
}

function generarCalendario(mes, año, feriados) {
    const diasSemana = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

    // Primero creamos el selector de mes/año fuera de la tabla
    let contenido = `
    <div class="selector-mes">
        <span class="arrow arrow-left">&#9664;</span>
        <span class="mes-anio">${meses[mes]} ${año}</span>
        <span class="arrow arrow-right">&#9654;</span>
    </div>
    <table>
        <thead><tr>`;

    // Luego agregamos los encabezados de los días de la semana
    diasSemana.forEach(dia => contenido += `<th>${dia}</th>`);
    contenido += `</tr></thead><tbody><tr>`;

    const primerDiaMes = new Date(año, mes, 1);
    const diaSemana = primerDiaMes.getDay();

    for (let i = 0; i < diaSemana; i++) {
        contenido += `<td></td>`;
    }

    const ultimoDiaMes = new Date(año, mes + 1, 0).getDate();
    const hoy = new Date();
    const esHoyMesActual = hoy.getMonth() === mes && hoy.getFullYear() === año;

    for (let dia = 1; dia <= ultimoDiaMes; dia++) {
        const fechaActual = new Date(año, mes, dia);
        const diaSemanaActual = fechaActual.getDay(); // 0 = domingo, 6 = sábado
        const esFinDeSemana = (diaSemanaActual === 0 || diaSemanaActual === 6);

        // Verificar si es feriado
        const esFeriado = feriados.some(feriado => {
            return feriado.fecha.toDateString() === fechaActual.toDateString();
        });

        const esHoy = esHoyMesActual && dia === hoy.getDate();

        let clase = '';
        if (esFeriado) {
            if (esFinDeSemana) {
                clase = 'feriado-finde ';
            } else {
                clase = 'feriado ';
            }
        }
        if (esHoy) clase += 'hoy';

        contenido += `<td class="${clase}">${dia}</td>`;

        if ((dia + diaSemana) % 7 === 0 && dia !== ultimoDiaMes) {
            contenido += `</tr><tr>`;
        }
    }

    contenido += `</tr></tbody></table>`;

    return contenido;
}

function mostrarListaFeriados(mes, año, feriados) {
    const listaFeriados = document.getElementById("listaFeriados");
    listaFeriados.innerHTML = '<h2>Feriados del mes</h2>';

    const feriadosMesActual = feriados.filter(feriado => {
        const fecha = feriado.fecha;
        return fecha.getMonth() === mes && fecha.getFullYear() === año;
    });

    if (feriadosMesActual.length === 0) {
        const noFeriados = document.createElement('div');
        noFeriados.textContent = 'No hay feriados este mes';
        listaFeriados.appendChild(noFeriados);
        return;
    }

    feriadosMesActual.forEach(feriado => {
        const feriadoItem = document.createElement('div');
        feriadoItem.classList.add('feriado-item');

        // Verificar si el feriado cae en fin de semana
        const diaSemana = feriado.fecha.getDay(); // 0 = domingo, 6 = sábado
        const esFinDeSemana = (diaSemana === 0 || diaSemana === 6);

        if (esFinDeSemana) {
            feriadoItem.classList.add('feriado-item-finde');
        }

        const nombre = document.createElement('span');
        nombre.classList.add('nombre');
        nombre.textContent = feriado.nombre;

        const fecha = document.createElement('span');
        fecha.classList.add('fecha');
        fecha.textContent = formatearFecha(feriado.fecha);

        // Agregar indicador de fin de semana si corresponde
        if (esFinDeSemana) {
            const indicador = document.createElement('span');
            indicador.classList.add('indicador-finde');
            indicador.textContent = '(fin de semana)';

            // Crear un nuevo elemento para el indicador en lugar de agregarlo al texto
            const indicadorContainer = document.createElement('div');
            indicadorContainer.appendChild(indicador);

            feriadoItem.appendChild(nombre);
            feriadoItem.appendChild(fecha);
            feriadoItem.appendChild(indicadorContainer);
        } else {
            feriadoItem.appendChild(nombre);
            feriadoItem.appendChild(fecha);
        }

        listaFeriados.appendChild(feriadoItem);
    });
}

function actualizarCalendarioYLista(mes, año, feriados) {
    mostrarCalendario(mes, año, feriados);
    mostrarListaFeriados(mes, año, feriados);
}

function formatearFecha(fecha) {
    const dias = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    const diaSemana = dias[fecha.getDay()];
    const dia = fecha.getDate();
    const mes = meses[fecha.getMonth()];
    const año = fecha.getFullYear();

    return `${diaSemana} ${dia} de ${mes} ${año}`;
}

function parseFeriados(data) {
    const feriados = [];
    const lines = data.split('\n');
    for (let line of lines) {
        if (line.trim() === '') continue; // Ignorar líneas vacías
        const [nombre, fecha] = line.split(',');
        feriados.push({ nombre, fecha: moment.tz(fecha.trim(), 'America/Argentina/Buenos_Aires').toDate() });
    }
    return feriados;
}
