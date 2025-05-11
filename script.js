document.addEventListener("DOMContentLoaded", function() {
    console.log("DOM cargado, iniciando aplicación...");

    fetch('feriados.txt')
        .then(response => {
            if (!response.ok) {
                throw new Error(`Error HTTP: ${response.status}`);
            }
            return response.text();
        })
        .then(data => {
            console.log("Datos de feriados cargados correctamente");
            const feriados = parseFeriados(data);
            console.log(`Total de feriados cargados: ${feriados.length}`);
            mostrarProximoFeriado(feriados);
        })
        .catch(error => {
            console.error('Error al leer el archivo de feriados:', error);
            document.getElementById("feriado").innerHTML = `
                <span class="nombre">Error al cargar los feriados</span>
                <span class="fecha">Por favor, recarga la página</span>`;
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
    console.log(`Procesando ${lines.length} líneas de feriados`);

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim() === '') {
            console.log(`Línea ${i+1}: vacía, ignorando`);
            continue; // Ignorar líneas vacías
        }

        try {
            const parts = line.split(',');
            if (parts.length !== 2) {
                console.warn(`Línea ${i+1}: formato incorrecto, ignorando: "${line}"`);
                continue;
            }

            const nombre = parts[0].trim();
            const fechaStr = parts[1].trim();

            // Verificar que la fecha sea válida
            const fechaMoment = moment.tz(fechaStr, 'America/Argentina/Buenos_Aires');
            if (!fechaMoment.isValid()) {
                console.warn(`Línea ${i+1}: fecha inválida: "${fechaStr}"`);
                continue;
            }

            const fecha = fechaMoment.toDate();
            feriados.push({ nombre, fecha });
            console.log(`Feriado agregado: ${nombre}, ${fecha.toDateString()}`);
        } catch (error) {
            console.error(`Error al procesar línea ${i+1}: ${error.message}`);
        }
    }

    // Ordenar feriados por fecha
    feriados.sort((a, b) => a.fecha - b.fecha);
    return feriados;
}

function mostrarProximoFeriado(feriados) {
    console.log("Ejecutando mostrarProximoFeriado...");

    if (!feriados || feriados.length === 0) {
        console.error("No hay feriados para mostrar");
        document.getElementById("feriado").innerHTML = `
            <span class="nombre">No hay feriados disponibles</span>
            <span class="fecha">Por favor, recarga la página</span>`;
        return;
    }

    const hoy = moment.tz('America/Argentina/Buenos_Aires').startOf('day').toDate();
    console.log("Fecha actual:", hoy.toDateString());

    let proximoFeriado = null;
    let proximoFeriadoDiaLaborable = null;
    let feriadoLargo = false;
    let diasLargo = 1;
    let esFeriadoFinDeSemana = false;

    // Buscar el próximo feriado (cualquier día)
    for (let i = 0; i < feriados.length; i++) {
        const fechaFeriado = feriados[i].fecha;
        console.log(`Evaluando feriado: ${feriados[i].nombre}, ${fechaFeriado.toDateString()}`);

        if (fechaFeriado >= hoy) {
            proximoFeriado = feriados[i];
            console.log(`Próximo feriado encontrado: ${proximoFeriado.nombre}, ${fechaFeriado.toDateString()}`);

            // Verificar si es fin de semana (sábado o domingo)
            const diaSemana = fechaFeriado.getDay(); // 0 = domingo, 6 = sábado
            esFeriadoFinDeSemana = (diaSemana === 0 || diaSemana === 6);
            console.log(`Es fin de semana: ${esFeriadoFinDeSemana} (día de la semana: ${diaSemana})`);

            // Buscar el próximo feriado en día laborable si el actual es fin de semana
            if (esFeriadoFinDeSemana) {
                for (let j = i + 1; j < feriados.length; j++) {
                    const siguienteFecha = feriados[j].fecha;
                    const siguienteDiaSemana = siguienteFecha.getDay();
                    console.log(`Evaluando siguiente feriado para día laborable: ${feriados[j].nombre}, día ${siguienteDiaSemana}`);

                    // Si es día laborable (lunes a viernes)
                    if (siguienteDiaSemana > 0 && siguienteDiaSemana < 6) {
                        proximoFeriadoDiaLaborable = feriados[j];
                        console.log(`Próximo feriado en día laborable: ${proximoFeriadoDiaLaborable.nombre}`);
                        break;
                    }
                }
            }

            // Verificar si es feriado largo
            if (i < feriados.length - 1) {
                const siguienteFeriado = feriados[i + 1].fecha;
                const diasDiferencia = Math.round((siguienteFeriado - fechaFeriado) / (1000 * 60 * 60 * 24));
                console.log(`Días entre este feriado y el siguiente: ${diasDiferencia}`);

                if (diasDiferencia === 1) {
                    feriadoLargo = true;
                    diasLargo = 2;
                    console.log("Es feriado largo");

                    for (let j = i + 1; j < feriados.length - 1; j++) {
                        const siguiente = feriados[j + 1].fecha;
                        const diasSiguiente = Math.round((siguiente - feriados[j].fecha) / (1000 * 60 * 60 * 24));

                        if (diasSiguiente === 1) {
                            diasLargo++;
                            console.log(`Feriado largo extendido a ${diasLargo} días`);
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
        console.log(`Días faltantes para el próximo feriado: ${diasFaltantes}`);

        try {
            // Limpiar el texto de los elementos para evitar problemas
            const introElement = document.querySelector("#diasFaltantes .intro");
            const numeroElement = document.querySelector("#diasFaltantes .numero");
            const restoElement = document.querySelector("#diasFaltantes .resto");

            if (!introElement || !numeroElement || !restoElement) {
                throw new Error("No se encontraron los elementos necesarios en el DOM");
            }

            introElement.textContent = "Faltan";
            restoElement.textContent = "para el próximo feriado";

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
                    numeroElement.textContent = "¡Hoy es feriado!";
                    introElement.textContent = "";
                    restoElement.textContent = `Faltan ${diasFaltantesProximo} días para el próximo feriado.`;
                } else {
                    numeroElement.textContent = "¡Hoy es feriado!";
                    introElement.textContent = "";
                    restoElement.textContent = "No hay más feriados este año.";
                }
            } else if (esFeriadoFinDeSemana && proximoFeriadoDiaLaborable) {
                // Si el próximo feriado cae en fin de semana y hay un feriado en día laborable después
                const fechaLaborable = proximoFeriadoDiaLaborable.fecha;
                const diasFaltantesLaborable = Math.ceil((fechaLaborable - hoy) / (1000 * 60 * 60 * 24));
                console.log(`Días faltantes para el feriado laborable: ${diasFaltantesLaborable}`);

                // Mostrar el feriado en día laborable como el principal
                numeroElement.textContent = `${diasFaltantesLaborable}`;

                if (feriadoLargo) {
                    introElement.textContent = `¡El próximo feriado es largo de ${diasLargo} días!`;
                }
            } else if (feriadoLargo) {
                numeroElement.textContent = `${diasFaltantes}`;
                introElement.textContent = `¡El próximo feriado es largo de ${diasLargo} días!`;
            } else {
                numeroElement.textContent = `${diasFaltantes}`;
            }

            // Construir el HTML para mostrar el feriado
            let feriadoHTML = '';

            // Si el próximo feriado cae en fin de semana y hay un feriado en día laborable después
            if (esFeriadoFinDeSemana && proximoFeriadoDiaLaborable) {
                const fechaLaborable = proximoFeriadoDiaLaborable.fecha;
                // Esta variable se usa para el mensaje en la consola
                console.log(`Preparando información del feriado laborable`);
                const fechaLaborableFormateada = formatearFecha(fechaLaborable);

                // Mostrar el feriado en día laborable como el principal
                feriadoHTML = `
                    <span class="nombre">${proximoFeriadoDiaLaborable.nombre}</span>
                    <span class="fecha">${fechaLaborableFormateada}</span>
                    <div class="finde-info">
                        <span class="aviso-finde">El próximo feriado es "${proximoFeriado.nombre}" (${fechaFormateada}, y faltan ${diasFaltantes} días), pero como cae en fin de semana, mostramos el siguiente día laborable.</span>
                    </div>`;
            } else {
                // Mostrar el próximo feriado normalmente
                feriadoHTML = `
                    <span class="nombre">${proximoFeriado.nombre}</span>
                    <span class="fecha">${fechaFormateada}</span>`;
            }

            const feriadoElement = document.getElementById("feriado");
            if (feriadoElement) {
                feriadoElement.innerHTML = feriadoHTML;
            } else {
                console.error("No se encontró el elemento #feriado en el DOM");
            }
        } catch (error) {
            console.error("Error al actualizar la interfaz:", error);
        }
    } else {
        console.log("No se encontró ningún próximo feriado");
        try {
            document.getElementById("feriado").textContent = "No hay más feriados este año.";
            document.querySelector("#diasFaltantes .numero").textContent = "";
            document.querySelector("#diasFaltantes .intro").textContent = "";
            document.querySelector("#diasFaltantes .resto").textContent = "";
        } catch (error) {
            console.error("Error al actualizar la interfaz para 'no hay feriados':", error);
        }
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
