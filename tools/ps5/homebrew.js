// Entrada de PokéSurvivor en el lanzador de websrv (ps5-payload-dev/websrv).
// Va en /data/homebrew/PokeSurvivor/homebrew.js. websrv la ejecuta en un iframe
// aislado que no puede abrir otras páginas, así que sólo lanza install.elf
// (tools/ps5/install), que pone el icono «PokeSurvivor» en el inicio. Ese icono
// abre el diagnóstico como app; desde él se entra al juego.
async function main() {
    return {
        mainText: 'PokéSurvivor',
        secondaryText: 'Instalar el icono en el inicio',
        imgPath: baseURL + '/fs' + window.workingDir + '/sce_sys/icon0.png',
        onclick: async () => {
            await ApiClient.launchApp(window.workingDir + '/install.elf');
            return true;
        }
    };
}
