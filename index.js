const express = require('express');
const puppeteer = require('puppeteer');

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
// CONFIGURACIÓN
// ==========================================
const CONFIG = {
    urlLogin: "https://administrativo.icarosoft.com/",
    urlLista: "https://administrativo.icarosoft.com/Listado_clientes_tickets/",
    user: "JOHANC",
    pass: "@VNjohanc16",
    selUser: '#id_sc_field_login', 
    selPass: '#id_sc_field_pswd',
};

let globalBrowser = null;
let mainPage = null;

const esperar = (ms) => new Promise(r => setTimeout(r, ms));

// ==========================================
// MOTOR V30 (SINTAXIS CORREGIDA)
// ==========================================
async function iniciarSistema() {
    console.log("🚀 Iniciando Motor V30 (FIX SINTAXIS)...");
    
    globalBrowser = await puppeteer.launch({ 
        headless: "new", 
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox', 
            '--disable-dev-shm-usage', 
            '--window-size=1920,1080', 
            '--start-maximized'
        ] 
    });

    mainPage = await globalBrowser.newPage();
    mainPage.setDefaultNavigationTimeout(60000); 

    await mainPage.setRequestInterception(true);
    mainPage.on('request', (req) => {
        if (['image', 'media', 'font'].includes(req.resourceType())) req.abort();
        else req.continue();
    });

    console.log("🔑 Iniciando sesión...");
    await mainPage.goto(CONFIG.urlLogin, { waitUntil: 'networkidle2' });

    if (await mainPage.$(CONFIG.selUser)) {
        await mainPage.type(CONFIG.selUser, CONFIG.user);
        await mainPage.type(CONFIG.selPass, CONFIG.pass);
        await mainPage.evaluate(() => {
            const spans = document.querySelectorAll('span');
            for (const span of spans) {
                if (span.innerText.includes('Login')) { span.click(); return; }
            }
        });
        await mainPage.waitForNavigation({ waitUntil: 'networkidle2' });
        console.log("✅ Login Exitoso.");
    }
}

// ==========================================
// EXTRACTOR SERVICIOS (LÓGICA HTML REAL)
// ==========================================
async function escanearFramesServicios(page) {
    for (const frame of page.frames()) {
        try {
            const data = await frame.evaluate(() => {
                // Buscamos SPANS que contengan el ID de código de producto (Plan)
                const planesElements = document.querySelectorAll('span[id^="id_sc_field_codigo_producto_"]');
                
                if (planesElements.length === 0) return null;
                
                const resultados = [];
                let nombreGlobal = "N/A";

                planesElements.forEach((elPlan, index) => {
                    // Buscamos la fila TR ancestro
                    const fila = elPlan.closest('tr[id^="SC_ancor"]');

                    if (fila) {
                        const limpiar = (texto, etiqueta) => {
                            if (!texto) return "N/A";
                            if (etiqueta) texto = texto.replace(etiqueta, '');
                            return texto.replace(/[\n\r]+/g, ' ').trim();
                        };

                        const getTexto = (partialId) => {
                            const el = fila.querySelector(`[id^="${partialId}"]`);
                            return el ? el.innerText : "";
                        };

                        // --- EXTRACCIÓN ---
                        
                        // 1. Plan
                        let plan = getTexto("id_sc_field_codigo_producto_");
                        plan = limpiar(plan, "Plan:");

                        // 2. IP
                        let ip = getTexto("id_sc_field_ip_servicio_");
                        ip = limpiar(ip, "Ip Servicio:");

                        // 3. Cliente Global
                        if (nombreGlobal === "N/A") {
                            let cliente = getTexto("id_sc_field_id_cliente_") || getTexto("id_sc_field_nombre_cliente_");
                            nombreGlobal = limpiar(cliente, "Cliente:");
                        }

                        // 4. Dirección
                        const elDir = fila.querySelector('a[id^="bdireccion_servicio"]');
                        let dir = "No detectada";
                        if (elDir) {
                            dir = elDir.getAttribute('title') || "No detectada";
                            dir = dir.replace(/^B\/\s*/i, '').trim();
                        }

                        // 5. Estado, Saldo, Fecha
                        const estado = getTexto("id_sc_field_estado_");
                        const saldo = getTexto("id_sc_field_saldo_");
                        const fecha = getTexto("id_sc_field_fecha_corte_actual_");

                        resultados.push({
                            numero_servicio: index + 1,
                            plan: plan,
                            ip: ip,
                            estado: estado || "N/A",
                            saldo: saldo || "N/A",
                            fecha_corte: fecha || "N/A",
                            direccion: dir
                        });
                    }
                });

                return {
                    nombre_cliente: nombreGlobal,
                    servicios: resultados
                };
            });

            if (data) return data; 
        } catch(e) {}
    }
    return null;
}

async function esperarServicios(page) {
    console.log(`      ⏳ Escaneando tabla de servicios...`);
    for (let i = 0; i < 8; i++) { 
        const data = await escanearFramesServicios(page);
        if (data && data.servicios.length > 0) {
            console.log(`      ✅ Datos capturados (${data.servicios.length} servicios).`);
            return data;
        }
        await esperar(1000);
    }
    console.log("      ⚠️ Tiempo agotado o tabla vacía.");
    return null;
}

// ==========================================
// FLUJO PRINCIPAL
// ==========================================
async function buscarCliente(idBusqueda) {
    if (!globalBrowser) throw new Error("Sistema iniciando...");
    console.log(`🤖 Procesando: ${idBusqueda}`);
    const page = await globalBrowser.newPage();
    page.setDefaultNavigationTimeout(60000);

    await page.setRequestInterception(true);
    page.on('request', (req) => {
        if (['image', 'media', 'font'].includes(req.resourceType())) req.abort();
        else req.continue();
    });

    try {
        await page.goto(CONFIG.urlLista, { waitUntil: 'networkidle2' });

        const searchIn = '#SC_fast_search_top'; 
        if (await page.$(searchIn)) {
            await page.type(searchIn, idBusqueda);
            await page.click('#SC_fast_search_submit_top');
            await esperar(3000); 
        }

        const mensajeError = await page.evaluate(() => {
            const el = document.querySelector('#sc_grid_body');
            return el ? el.innerText.trim() : null;
        });
        if (mensajeError && mensajeError.includes('No hay registros')) {
            await page.close();
            return { success: false, mensaje: "No hay registros" };
        }

        try { await page.waitForSelector('.fa-user-edit', { timeout: 10000 }); } 
        catch(e) { throw new Error("Cliente no encontrado."); }

        const newTargetPromise = globalBrowser.waitForTarget(target => target.opener() === page.target());
        await page.click('.fa-user-edit');
        const tab = await (await newTargetPromise).page();
        
        await tab.setRequestInterception(true);
        tab.on('request', (req) => {
            if (['image', 'media', 'font'].includes(req.resourceType())) req.abort();
            else req.continue();
        });

        await tab.bringToFront();
        await esperar(4000); 

        const encontrarFrame = async (selector) => {
            for (const frame of tab.frames()) {
                try { if (await frame.$(selector)) return frame; } catch(e){}
            }
            return null;
        };

        // --- A. DATOS FIJOS ---
        let codigo = "N/A", movil = "N/A", fijo = "N/A";
        const frameDatos = await encontrarFrame('#id_sc_field_cod_cliente');
        
        if (frameDatos) {
            const datos = await frameDatos.evaluate(() => {
                // AQUÍ ESTABA EL ERROR: definimos getVal y usamos getV
                const getVal = (id) => { 
                    const el = document.querySelector(id); return el ? el.value : "N/A"; 
                };
                return {
                    c: getVal('#id_sc_field_cod_cliente'),
                    m: getVal('#id_sc_field_telefono_movil'),
                    f: getVal('#id_sc_field_telefono_fijo') // <--- CORREGIDO (decía getV)
                };
            });
            codigo = datos.c; movil = datos.m; fijo = datos.f;
        }

        // --- B. LINK ---
        let linkPago = "No capturado";
        const frameLink = await encontrarFrame('#sc_copiar_top');
        if (frameLink) {
            try {
                const dialogPromise = new Promise(resolve => {
                    const t = setTimeout(() => resolve(null), 1500); 
                    tab.once('dialog', async dialog => {
                        clearTimeout(t);
                        linkPago = dialog.message().replace("Texto copiado con éxito:", "").trim();
                        await dialog.accept(); 
                        resolve(true);
                    });
                });
                await frameLink.click('#sc_copiar_top');
                await dialogPromise;
            } catch (e) {}
        }

        // --- C. SERVICIOS ---
        console.log("   ⬇️ Escaneando servicios...");
        const frameTabs = await encontrarFrame('#cel2 a');
        if (frameTabs) {
             try { await frameTabs.click('#cel2 a'); await esperar(1500); } catch(e){}
        }
        
        let resultado = await esperarServicios(tab);
        let nombreCliente = "N/A";
        let listaServicios = [];

        if (resultado) {
            nombreCliente = resultado.nombre_cliente || "N/A";
            listaServicios = resultado.servicios || [];
        }

        await tab.close();
        await page.close();

        return {
            id_busqueda: idBusqueda,
            nombre_cliente: nombreCliente,
            codigo_cliente: codigo,
            movil: movil,
            fijo: fijo,
            link_pago: linkPago,
            servicios: listaServicios
        };

    } catch (error) {
        if(page && !page.isClosed()) await page.close();
        throw error;
    }
}

app.get('/buscar', async (req, res) => {
    try {
        const datos = await buscarCliente(req.query.id);
        res.json({ success: true, data: datos });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.listen(PORT, async () => {
    console.log(`\n🚀 SERVIDOR V30 LISTO: http://localhost:${PORT}`);
    
    // 1. Arranque inicial
    await iniciarSistema();

    // 2. CICLO DE REINICIO (CADA 10 MINUTOS)
    setInterval(async () => {
        console.log("\n♻️ MANTENIMIENTO: Reiniciando navegador (Ciclo 10 min)...");

        // A. Cerrar Navegador
        if (globalBrowser) {
            try { await globalBrowser.close(); } catch(e) { console.log("   ⚠️ Error cerrando (ignorable)."); }
            globalBrowser = null;
            mainPage = null;
        }

        // B. Volver a Iniciar (Abre y Loguea)
        console.log("   🔄 Re-iniciando sistema...");
        await iniciarSistema();
        console.log("   ✅ Mantenimiento finalizado.");

    }, 600000); // 600,000 ms = 10 minutos exactos
});
