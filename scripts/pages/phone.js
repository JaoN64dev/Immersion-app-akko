// Settings → Use akko on your phone (server/lan.js): turn it on, show the address, a QR code of it
// and the PIN. Only the computer akko runs on can see or change this.

import { $ } from "../core/dom.js";
import { getJson, loadScript, escapeHtml } from "../core/utils.js";

const QR_JS = "https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js";

const ui = {
    on: $("#phone-on"), details: $("#phone-details"), address: $("#phone-address"), pin: $("#phone-pin"),
    qr: $("#phone-qr"), devices: $("#phone-devices"), newPin: $("#phone-new-pin"), msg: $("#phone-msg"),
};

async function render(s) {
    ui.on.checked = s.enabled;
    ui.details.hidden = !s.enabled;
    if (!s.enabled) { ui.msg.textContent = ""; return; }
    const url = s.addresses.length ? `http://${s.addresses[0]}:${s.port}` : "";
    ui.address.textContent = url || `this computer's address, port ${s.port}`;
    if (s.addresses.length > 1) ui.address.title = s.addresses.map((a) => `http://${a}:${s.port}`).join("\n");
    ui.pin.textContent = s.pin;
    ui.devices.textContent = s.devices ? `${s.devices} device${s.devices === 1 ? "" : "s"} signed in` : "no device signed in yet";
    ui.msg.textContent = s.running ? "" : "couldn't open the network port: another program may be using it";
    ui.qr.innerHTML = "";
    if (!url) { ui.msg.textContent = "this computer isn't on a home network right now"; return; }
    try {
        await loadScript(QR_JS);
        const qr = window.qrcode(0, "M");
        qr.addData(url);
        qr.make();
        ui.qr.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    } catch { ui.qr.innerHTML = `<small>${escapeHtml(url)}</small>`; }      // offline: just the address
}

async function change(body) {
    try {
        render(await getJson("/api/lan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
    } catch (err) {
        ui.msg.textContent = err.message;
    }
}

export async function init() {
    if (!ui.on) return;
    let s;
    try {
        s = await getJson("/api/lan");
    } catch {
        // opened on the phone itself: these settings live on the computer
        $("#phone-section .phone-switch").hidden = true;
        ui.msg.textContent = "you're on another device: change this in akko on the computer.";
        return;
    }
    render(s);
    ui.on.addEventListener("input", () => change({ enabled: ui.on.checked }));
    ui.newPin.addEventListener("click", () => change({ newPin: true }));
}
