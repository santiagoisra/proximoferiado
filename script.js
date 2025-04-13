document.addEventListener("DOMContentLoaded", function() {
    fetch('feriados.txt')
        .then(response => response.text())
        .then(data => {
            const feriados = parseFeriados(data);
            mostrarProximoFeriado(feriados);
        })
        .catch(error => {
            console.error('Error al leer el archivo de feriados:', error);
        });

    const modal = document.getElementById("calendarioModal");
    const btn = document.getElementById("verCalendarioBtn");
    const span = document.getElementsByClassName("close")[0];

    modal.style.display = "none"; // Asegurarse de que el modal no esté visible al cargar la página

    btn.onclick = function() {
        modal.style.display = "block";
        centrarModal(modal); // Centrar el modal cuando se abre
    }

    span.onclick = function() {
        modal.style.display = "none";
    }

    window.onclick = function(event) {
        if (event.target == modal) {
            modal.style.display = "none";
        }
    }
});

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

function mostrarProximoFeriado(feriados) {
    const hoy = moment.tz('America/Argentina/Buenos_Aires').startOf('day').toDate();
    let proximoFeriado = null;
    let feriadoLargo = false;
    let diasLargo = 1;

    for (let i = 0; i < feriados.length; i++) {
        const fechaFeriado = feriados[i].fecha;

        if (fechaFeriado >= hoy) {
            proximoFeriado = feriados[i];
            if (i < feriados.length - 1) {
                const siguienteFeriado = feriados[i + 1].fecha;

                if ((siguienteFeriado - fechaFeriado) / (1000 * 60 * 60 * 24) === 1) {
                    feriadoLargo = true;
                    diasLargo = 2;
                    for (let j = i + 1; j < feriados.length - 1; j++) {
                        const siguiente = feriados[j + 1].fecha;
                        if ((siguiente - feriados[j].fecha) / (1000 * 60 * 60 * 24) === 1) {
                            diasLargo++;
                        } else {
                            break;
                        }
                    }
                }
            }
            break;
        }
    }

    if (proximoFeriado) {
        const fechaFeriado = proximoFeriado.fecha;
        const diasFaltantes = Math.ceil((fechaFeriado - hoy) / (1000 * 60 * 60 * 24));
        const fechaFormateada = formatearFecha(fechaFeriado);

        if (diasFaltantes === 0) {
            // Calcular el próximo feriado después del día de hoy
            let proximoFeriadoDespuesDeHoy = null;
            for (let i = feriados.indexOf(proximoFeriado) + 1; i < feriados.length; i++) {
                if (feriados[i].fecha > hoy) {
                    proximoFeriadoDespuesDeHoy = feriados[i];
                    break;
                }
            }

            if (proximoFeriadoDespuesDeHoy) {
                const diasFaltantesProximo = Math.ceil((proximoFeriadoDespuesDeHoy.fecha - hoy) / (1000 * 60 * 60 * 24));
                document.querySelector("#diasFaltantes .numero").textContent = "¡Hoy es feriado!";
                document.querySelector("#diasFaltantes .intro").textContent = "";
                document.querySelector("#diasFaltantes .resto").textContent = `Faltan ${diasFaltantesProximo} días para el próximo feriado.`;
            } else {
                document.querySelector("#diasFaltantes .numero").textContent = "¡Hoy es feriado!";
                document.querySelector("#diasFaltantes .intro").textContent = "";
                document.querySelector("#diasFaltantes .resto").textContent = "No hay más feriados este año.";
            }
        } else if (feriadoLargo) {
            const siguienteFeriado = feriados[feriados.indexOf(proximoFeriado) + 1].fecha;
            const diasFaltantesSiguiente = Math.ceil((siguienteFeriado - hoy) / (1000 * 60 * 60 * 24));
            document.querySelector("#diasFaltantes .numero").textContent =`Faltan ${diasFaltantes} días`;
            document.querySelector("#diasFaltantes .intro").textContent = `¡El próximo feriado es largo de ${diasLargo} días!`;
            document.querySelector("#diasFaltantes .resto").textContent = `Para el próximo feriado`;
        } else {
            document.querySelector("#diasFaltantes .numero").textContent = `${diasFaltantes} días`;
        }
        
        document.getElementById("feriado").innerHTML = `
            <span class="nombre">${proximoFeriado.nombre}</span>
            <span class="fecha">${fechaFormateada}</span>`;
    } else {
        document.getElementById("feriado").textContent = "No hay más feriados este año.";
        document.querySelector("#diasFaltantes .numero").textContent = "";
        document.querySelector("#diasFaltantes .intro").textContent = "";
        document.querySelector("#diasFaltantes .resto").textContent = "";
    }
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

function centrarModal(modal) {
    const modalContent = modal.querySelector('.modal-content');
    const screenHeight = window.innerHeight;
    const screenWidth = window.innerWidth;
    const modalHeight = modalContent.offsetHeight;
    const modalWidth = modalContent.offsetWidth;
    modalContent.style.top = `${(screenHeight - modalHeight) / 2}px`;
    modalContent.style.left = `${(screenWidth - modalWidth) / 2}px`;
}