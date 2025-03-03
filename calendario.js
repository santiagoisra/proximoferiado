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
    document.querySelector('.arrow-left').addEventListener('click', function() {
        if (mes === 0) {
            mes = 11;
            año -= 1;
        } else {
            mes -= 1;
        }
        actualizarCalendarioYLista(mes, año, feriados);
    });

    document.querySelector('.arrow-right').addEventListener('click', function() {
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

    let tabla = `<table><caption><span class="arrow arrow-left">&#9664;</span>${meses[mes]} ${año}<span class="arrow arrow-right">&#9654;</span></caption><thead><tr>`;
    diasSemana.forEach(dia => tabla += `<th>${dia}</th>`);
    tabla += `</tr></thead><tbody><tr>`;

    const primerDiaMes = new Date(año, mes, 1);
    const diaSemana = primerDiaMes.getDay();

    for (let i = 0; i < diaSemana; i++) {
        tabla += `<td></td>`;
    }

    const ultimoDiaMes = new Date(año, mes + 1, 0).getDate();
    const hoy = new Date();
    const esHoyMesActual = hoy.getMonth() === mes && hoy.getFullYear() === año;

    for (let dia = 1; dia <= ultimoDiaMes; dia++) {
        const fechaActual = new Date(año, mes, dia);
        const esFeriado = feriados.some(feriado => {
            return feriado.fecha.toDateString() === fechaActual.toDateString();
        });
        const esHoy = esHoyMesActual && dia === hoy.getDate();

        let clase = '';
        if (esFeriado) clase += 'feriado ';
        if (esHoy) clase += 'hoy';

        tabla += `<td class="${clase}">${dia}</td>`;

        if ((dia + diaSemana) % 7 === 0 && dia !== ultimoDiaMes) {
            tabla += `</tr><tr>`;
        }
    }

    tabla += `</tr></tbody></table>`;

    return tabla;
}

function mostrarListaFeriados(mes, año, feriados) {
    const listaFeriados = document.getElementById("listaFeriados");
    listaFeriados.innerHTML = '';

    const feriadosMesActual = feriados.filter(feriado => {
        const fecha = feriado.fecha;
        return fecha.getMonth() === mes && fecha.getFullYear() === año;
    });

    feriadosMesActual.forEach(feriado => {
        const feriadoItem = document.createElement('div');
        feriadoItem.classList.add('feriado-item');
        const nombre = document.createElement('span');
        nombre.classList.add('nombre');
        nombre.textContent = feriado.nombre;
        const fecha = document.createElement('span');
        fecha.classList.add('fecha');
        fecha.textContent = formatearFecha(feriado.fecha);
        feriadoItem.appendChild(nombre);
        feriadoItem.appendChild(fecha);
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