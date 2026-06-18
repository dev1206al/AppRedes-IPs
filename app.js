"use strict";

const STORAGE_KEY = "redes-ipv4-calculadora";
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const state = {
  lastSubnet: null,
  lastRoutes: null,
  routers: ["R1", "R2", "R3"],
  saved: []
};

document.addEventListener("DOMContentLoaded", () => {
  restoreState();
  bindTabs();
  bindSubnet();
  bindRouting();
  bindStorageButtons();
  renderSaved();
  registerServiceWorker();
  renderRouterRows();
  calculateSubnet();
  generateRoutes();
});

function bindTabs() {
  $$(".tab-button").forEach((button) => {
    button.addEventListener("click", () => {
      $$(".tab-button").forEach((item) => item.classList.remove("active"));
      $$(".panel").forEach((panel) => panel.classList.remove("active"));
      button.classList.add("active");
      $(`#${button.dataset.tab}Panel`).classList.add("active");
    });
  });
}

function bindSubnet() {
  $("#subnetForm").addEventListener("submit", (event) => {
    event.preventDefault();
    calculateSubnet();
  });
  $("#loadExample1").addEventListener("click", () => loadSubnetExample("172.23.0.0", 16, 240));
  $("#loadExample2").addEventListener("click", () => loadSubnetExample("25.0.0.0", 8, 625));
  $("#copySubnet").addEventListener("click", () => copyText(buildSubnetText()));
  $("#saveSubnet").addEventListener("click", () => saveExercise("subnet"));
}

function bindRouting() {
  $("#syncRouters").addEventListener("click", () => {
    state.routers = parseRouters();
    renderRouterRows();
    generateRoutes();
  });
  $("#addLan").addEventListener("click", () => addLanRow());
  $("#addLink").addEventListener("click", () => addLinkRow());
  $("#calculateRoutes").addEventListener("click", generateRoutes);
  $("#copyAllCommands").addEventListener("click", () => copyText(buildAllCommandsText()));
  $("#copyRouteTable").addEventListener("click", () => copyText(buildRouteTableText()));
  $("#saveRouting").addEventListener("click", () => saveExercise("routing"));
  $("#loadRoutingExample").addEventListener("click", loadRoutingExample);
}

function bindStorageButtons() {
  $("#clearData").addEventListener("click", () => {
    localStorage.removeItem(STORAGE_KEY);
    state.saved = [];
    renderSaved();
    toast("Datos locales borrados");
  });
}

function loadSubnetExample(ip, cidr, needed) {
  $("#baseIp").value = ip;
  $("#baseCidr").value = String(cidr);
  $("#neededSubnets").value = String(needed);
  $("#showCount").value = "8";
  $("input[name='serverMode'][value='separate']").checked = true;
  calculateSubnet();
}

function calculateSubnet() {
  clearError("#subnetErrors");
  const baseIp = $("#baseIp").value.trim();
  const baseCidr = normalizeCidr($("#baseCidr").value);
  const needed = Number($("#neededSubnets").value);
  const showCount = $("#showCount").value;
  const serverMode = $("input[name='serverMode']:checked").value;

  try {
    const baseInt = ipToInt(baseIp);
    if (!Number.isInteger(baseCidr) || baseCidr < 0 || baseCidr > 30) {
      throw new Error("La máscara inicial debe estar entre /0 y /30.");
    }
    if (!Number.isInteger(needed) || needed < 1) {
      throw new Error("El número de subredes necesarias debe ser un entero mayor que cero.");
    }

    const originalNetwork = networkAddress(baseInt, baseCidr);
    const trials = [];
    let borrowed = 0;
    while (2 ** borrowed < needed) {
      borrowed += 1;
      trials.push({ n: borrowed, value: 2 ** borrowed, ok: 2 ** borrowed >= needed });
    }

    const newCidr = baseCidr + borrowed;
    if (newCidr > 30) {
      throw new Error("La nueva máscara pasa de /30. Para estos ejercicios se necesitan IPs asignables suficientes.");
    }

    const hostBits = 32 - newCidr;
    const totalIps = 2 ** hostBits;
    const usable = totalIps - 2;
    if (serverMode === "separate" && usable < 4) {
      throw new Error("No hay suficientes hosts para Gateway, DNS, DHCP y WEB separados.");
    }
    if (serverMode === "combined" && usable < 2) {
      throw new Error("No hay suficientes hosts para Gateway y servidor.");
    }

    const possibleSubnets = 2 ** borrowed;
    const displayCount = showCount === "all" ? possibleSubnets : Math.min(Number(showCount), possibleSubnets);
    const mask = cidrToMask(newCidr);
    const subnets = [];

    for (let index = 0; index < displayCount; index += 1) {
      const red = (originalNetwork + index * totalIps) >>> 0;
      const broadcast = (red + totalIps - 1) >>> 0;
      const first = (red + 1) >>> 0;
      const last = (broadcast - 1) >>> 0;
      const dns = serverMode === "combined" ? last : (last - 2) >>> 0;
      const dhcp = serverMode === "combined" ? last : (last - 1) >>> 0;
      const web = last;
      subnets.push({
        number: index + 1,
        red,
        broadcast,
        mask,
        range: `${intToIp(first)} - ${intToIp(last)}`,
        gateway: intToIp(first),
        dns: intToIp(dns),
        dhcp: intToIp(dhcp),
        web: intToIp(web)
      });
    }

    state.lastSubnet = {
      input: { baseIp, baseCidr, needed, showCount, serverMode },
      originalNetwork: intToIp(originalNetwork),
      borrowed,
      newCidr,
      hostBits,
      totalIps,
      usable,
      possibleSubnets,
      mask,
      blockSize: totalIps,
      trials,
      subnets
    };

    persistState();
    renderSubnetResult();
  } catch (error) {
    state.lastSubnet = null;
    renderSubnetResult();
    showError("#subnetErrors", error.message);
  }
}

function renderSubnetResult() {
  const result = state.lastSubnet;
  $("#processList").innerHTML = "";
  $("#subnetHighlights").innerHTML = "";
  $("#subnetTable").innerHTML = "";
  $("#tableCount").textContent = "";

  if (!result) {
    $("#subnetSummary").textContent = "Corrige los datos para calcular";
    return;
  }

  $("#subnetSummary").textContent = `${result.possibleSubnets} subredes posibles con /${result.newCidr}`;
  const trialText = result.trials
    .map((trial) => `2^${trial.n} = ${trial.value} ${trial.ok ? "sí alcanza" : "no alcanza"}`)
    .join("; ");
  const steps = [
    `IP y máscara original: ${result.input.baseIp}/${result.input.baseCidr}. Red calculada: ${result.originalNetwork}/${result.input.baseCidr}.`,
    `Subredes necesarias: ${result.input.needed}.`,
    `Se busca n con 2^n >= ${result.input.needed}: ${trialText}.`,
    `Bits prestados: n = ${result.borrowed}.`,
    `Nueva máscara = ${result.input.baseCidr} + ${result.borrowed} = /${result.newCidr}.`,
    `Máscara decimal: ${result.mask}.`,
    `Bits de host = 32 - ${result.newCidr} = ${result.hostBits}.`,
    `IPs totales por subred = 2^${result.hostBits} = ${result.totalIps}.`,
    `IPs asignables = ${result.totalIps} - 2 = ${result.usable}.`,
    `Salto o tamaño de bloque: ${result.blockSize} direcciones por subred.`
  ];
  $("#processList").innerHTML = steps.map((step) => `<li>${escapeHtml(step)}</li>`).join("");

  const highlights = [
    ["Nueva máscara", `/${result.newCidr} (${result.mask})`],
    ["Bits prestados", result.borrowed],
    ["IPs asignables", result.usable],
    ["Servidores", result.input.serverMode === "combined" ? "Un solo servidor" : "Separados"]
  ];
  $("#subnetHighlights").innerHTML = highlights.map(([label, value]) => (
    `<div class="highlight"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></div>`
  )).join("");

  $("#tableCount").textContent = `Mostrando ${result.subnets.length} de ${result.possibleSubnets}`;
  $("#subnetTable").innerHTML = result.subnets.map((subnet) => `
    <tr>
      <td><span class="tag">${subnet.number}</span></td>
      <td>${intToIp(subnet.red)}</td>
      <td>${intToIp(subnet.broadcast)}</td>
      <td>${subnet.mask}</td>
      <td><strong>${subnet.range}</strong></td>
      <td><strong>${subnet.gateway}</strong></td>
      <td>${subnet.dns}</td>
      <td>${subnet.dhcp}</td>
      <td>${subnet.web}</td>
    </tr>
  `).join("");
}

function renderRouterRows() {
  const routers = parseRouters();
  state.routers = routers.length ? routers : ["R1"];
  $("#routerNames").value = state.routers.join(", ");

  if (!$("#lanRows").children.length) {
    addLanRow({ label: "VLAN 60 Civil", network: "172.23.6.0", mask: "255.255.255.0", router: "R1" });
    addLanRow({ label: "VLAN 70 Sistemas", network: "172.23.7.0", mask: "255.255.255.0", router: "R2" });
    addLanRow({ label: "VLAN 80 Admin", network: "172.23.8.0", mask: "255.255.255.0", router: "R3" });
  }
  if (!$("#linkRows").children.length) {
    addLinkRow({ a: "R1", ipA: "10.0.0.1", b: "R2", ipB: "10.0.0.2" });
    addLinkRow({ a: "R2", ipA: "10.0.0.5", b: "R3", ipB: "10.0.0.6" });
  }

  $$(".router-select").forEach((select) => refreshRouterSelect(select, select.value));
}

function addLanRow(data = {}) {
  const row = document.createElement("div");
  row.className = "row-card lan-row";
  row.innerHTML = `
    <label>Etiqueta<input class="lan-label" value="${escapeAttr(data.label || "")}" placeholder="VLAN 60 Civil"></label>
    <label>Red<input class="lan-network" value="${escapeAttr(data.network || "")}" inputmode="decimal" placeholder="172.23.6.0"></label>
    <label>Máscara<input class="lan-mask" value="${escapeAttr(data.mask || "")}" inputmode="decimal" placeholder="255.255.255.0"></label>
    <label>Router<select class="lan-router router-select"></select></label>
    <button type="button" class="remove-row" aria-label="Eliminar LAN">×</button>
  `;
  $("#lanRows").append(row);
  refreshRouterSelect(row.querySelector(".lan-router"), data.router);
  row.querySelector(".remove-row").addEventListener("click", () => row.remove());
}

function addLinkRow(data = {}) {
  const row = document.createElement("div");
  row.className = "row-card link-row";
  row.innerHTML = `
    <label>Router A<select class="link-a router-select"></select></label>
    <label>IP Router A<input class="link-ip-a" value="${escapeAttr(data.ipA || "")}" inputmode="decimal" placeholder="10.0.0.1"></label>
    <label>Router B<select class="link-b router-select"></select></label>
    <label>IP Router B<input class="link-ip-b" value="${escapeAttr(data.ipB || "")}" inputmode="decimal" placeholder="10.0.0.2"></label>
    <button type="button" class="remove-row" aria-label="Eliminar enlace">×</button>
  `;
  $("#linkRows").append(row);
  refreshRouterSelect(row.querySelector(".link-a"), data.a);
  refreshRouterSelect(row.querySelector(".link-b"), data.b);
  row.querySelector(".remove-row").addEventListener("click", () => row.remove());
}

function loadRoutingExample() {
  $("#routerNames").value = "R1, R2, R3";
  state.routers = parseRouters();
  $("#lanRows").innerHTML = "";
  $("#linkRows").innerHTML = "";
  renderRouterRows();
  generateRoutes();
}

function generateRoutes() {
  clearError("#routingErrors");
  try {
    state.routers = parseRouters();
    if (!state.routers.length) throw new Error("Agrega al menos un router.");
    const lans = readLans();
    const links = readLinks();
    const graph = buildGraph(state.routers, links);
    const routes = [];
    const commandsByRouter = {};

    state.routers.forEach((router) => {
      commandsByRouter[router] = ["enable", "configure terminal"];
      lans.filter((lan) => lan.router !== router).forEach((lan) => {
        const path = shortestPath(graph, router, lan.router);
        if (!path || path.length < 2) {
          routes.push({
            router,
            network: lan.network,
            mask: lan.mask,
            nextHop: "Sin ruta",
            explanation: `No hay enlace conocido desde ${router} hacia ${lan.router}.`
          });
          return;
        }
        const neighbor = path[1];
        const nextHop = graph[router].find((edge) => edge.to === neighbor).neighborIp;
        const command = `ip route ${lan.network} ${lan.mask} ${nextHop}`;
        commandsByRouter[router].push(command);
        routes.push({
          router,
          network: lan.network,
          mask: lan.mask,
          nextHop,
          explanation: `Para llegar a la red ${lan.network}/${maskToCidr(lan.mask)} desde ${router}, el siguiente salto es ${nextHop}, que pertenece al router vecino ${neighbor}.`
        });
      });
      commandsByRouter[router].push("end", "write memory");
    });

    state.lastRoutes = { routers: state.routers, lans, links, routes, commandsByRouter };
    persistState();
    renderRoutes();
  } catch (error) {
    state.lastRoutes = null;
    renderRoutes();
    showError("#routingErrors", error.message);
  }
}

function renderRoutes() {
  const result = state.lastRoutes;
  $("#knownNetworksTable").innerHTML = "";
  $("#routesTable").innerHTML = "";
  $("#commandsOutput").innerHTML = "";
  if (!result) return;

  $("#knownNetworksTable").innerHTML = result.lans.map((lan) => `
    <tr>
      <td>${escapeHtml(lan.label)}</td>
      <td>${lan.network}</td>
      <td>${lan.mask}</td>
      <td><span class="tag">${escapeHtml(lan.router)}</span></td>
    </tr>
  `).join("");

  $("#routesTable").innerHTML = result.routes.map((route) => `
    <tr>
      <td>${escapeHtml(route.router)}</td>
      <td>${route.network}</td>
      <td>${route.mask}</td>
      <td><strong>${route.nextHop}</strong></td>
      <td>${escapeHtml(route.explanation)}</td>
    </tr>
  `).join("");

  $("#commandsOutput").innerHTML = result.routers.map((router) => {
    const text = result.commandsByRouter[router].join("\n");
    return `
      <section class="command-card">
        <header>
          <h3>Router ${escapeHtml(router)}</h3>
          <button type="button" data-router="${escapeAttr(router)}">Copiar</button>
        </header>
        <pre>${escapeHtml(text)}</pre>
      </section>
    `;
  }).join("");

  $$("#commandsOutput button").forEach((button) => {
    button.addEventListener("click", () => {
      const router = button.dataset.router;
      copyText(result.commandsByRouter[router].join("\n"));
    });
  });
}

function readLans() {
  const lans = $$(".lan-row").map((row) => ({
    label: row.querySelector(".lan-label").value.trim() || "LAN",
    network: row.querySelector(".lan-network").value.trim(),
    mask: row.querySelector(".lan-mask").value.trim(),
    router: row.querySelector(".lan-router").value
  }));
  if (!lans.length) throw new Error("Agrega al menos una red LAN.");
  lans.forEach((lan) => {
    ipToInt(lan.network);
    maskToCidr(lan.mask);
    if (!state.routers.includes(lan.router)) throw new Error(`El router ${lan.router} no existe.`);
  });
  return lans;
}

function readLinks() {
  const links = $$(".link-row").map((row) => ({
    a: row.querySelector(".link-a").value,
    ipA: row.querySelector(".link-ip-a").value.trim(),
    b: row.querySelector(".link-b").value,
    ipB: row.querySelector(".link-ip-b").value.trim()
  }));
  links.forEach((link) => {
    if (link.a === link.b) throw new Error("Un enlace debe conectar dos routers diferentes.");
    ipToInt(link.ipA);
    ipToInt(link.ipB);
  });
  return links;
}

function buildGraph(routers, links) {
  const graph = Object.fromEntries(routers.map((router) => [router, []]));
  links.forEach((link) => {
    graph[link.a].push({ to: link.b, neighborIp: link.ipB });
    graph[link.b].push({ to: link.a, neighborIp: link.ipA });
  });
  return graph;
}

function shortestPath(graph, start, end) {
  const queue = [[start]];
  const seen = new Set([start]);
  while (queue.length) {
    const path = queue.shift();
    const current = path[path.length - 1];
    if (current === end) return path;
    for (const edge of graph[current] || []) {
      if (!seen.has(edge.to)) {
        seen.add(edge.to);
        queue.push([...path, edge.to]);
      }
    }
  }
  return null;
}

function parseRouters() {
  return $("#routerNames").value.split(",").map((name) => name.trim()).filter(Boolean);
}

function refreshRouterSelect(select, selected) {
  select.innerHTML = state.routers.map((router) => (
    `<option value="${escapeAttr(router)}">${escapeHtml(router)}</option>`
  )).join("");
  if (selected && state.routers.includes(selected)) select.value = selected;
}

function saveExercise(type) {
  if (type === "subnet" && !state.lastSubnet) calculateSubnet();
  if (type === "routing" && !state.lastRoutes) generateRoutes();
  const payload = type === "subnet" ? state.lastSubnet : state.lastRoutes;
  if (!payload) return toast("No hay un resultado válido para guardar");
  state.saved.unshift({
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    type,
    date: new Date().toLocaleString("es-MX"),
    title: type === "subnet"
      ? `${payload.input.baseIp}/${payload.input.baseCidr} a /${payload.newCidr}`
      : `${payload.routers.length} routers, ${payload.routes.length} rutas`,
    payload
  });
  state.saved = state.saved.slice(0, 20);
  persistState();
  renderSaved();
  toast("Ejercicio guardado");
}

function renderSaved() {
  if (!state.saved.length) {
    $("#savedList").innerHTML = "<p class=\"muted\">Aún no hay ejercicios guardados.</p>";
    return;
  }
  $("#savedList").innerHTML = state.saved.map((item) => `
    <div class="saved-item">
      <div>
        <strong>${escapeHtml(item.title)}</strong>
        <div class="muted">${item.type === "subnet" ? "Subneteo" : "Enrutamiento"} · ${escapeHtml(item.date)}</div>
      </div>
      <button type="button" data-id="${escapeAttr(item.id)}">Cargar</button>
    </div>
  `).join("");
  $$("#savedList button").forEach((button) => {
    button.addEventListener("click", () => loadSaved(button.dataset.id));
  });
}

function loadSaved(id) {
  const item = state.saved.find((saved) => saved.id === id);
  if (!item) return;
  if (item.type === "subnet") {
    const input = item.payload.input;
    $("#baseIp").value = input.baseIp;
    $("#baseCidr").value = String(input.baseCidr);
    $("#neededSubnets").value = String(input.needed);
    $("#showCount").value = input.showCount;
    $(`input[name='serverMode'][value='${input.serverMode}']`).checked = true;
    calculateSubnet();
    activateTab("subnet");
  } else {
    $("#routerNames").value = item.payload.routers.join(", ");
    state.routers = parseRouters();
    $("#lanRows").innerHTML = "";
    $("#linkRows").innerHTML = "";
    item.payload.lans.forEach(addLanRow);
    item.payload.links.forEach(addLinkRow);
    generateRoutes();
    activateTab("routing");
  }
  toast("Ejercicio cargado");
}

function activateTab(name) {
  document.querySelector(`.tab-button[data-tab='${name}']`).click();
}

function persistState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    saved: state.saved,
    lastSubnet: state.lastSubnet,
    lastRoutes: state.lastRoutes
  }));
}

function restoreState() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    state.saved = stored.saved || [];
  } catch {
    state.saved = [];
  }
}

function buildSubnetText() {
  const result = state.lastSubnet;
  if (!result) return "Sin resultados de subneteo.";
  const rows = result.subnets.map((subnet) => [
    subnet.number,
    intToIp(subnet.red),
    intToIp(subnet.broadcast),
    subnet.mask,
    subnet.range,
    subnet.gateway,
    subnet.dns,
    subnet.dhcp,
    subnet.web
  ].join("\t"));
  return [
    `Subneteo ${result.input.baseIp}/${result.input.baseCidr}`,
    `Nueva máscara: /${result.newCidr} (${result.mask})`,
    `Bits prestados: ${result.borrowed}`,
    `IPs asignables: ${result.usable}`,
    "Subred\tDesde/red\tHasta/broadcast\tMáscara\tIPs asignables\tGateway\tDNS\tDHCP\tWEB",
    ...rows
  ].join("\n");
}

function buildAllCommandsText() {
  const result = state.lastRoutes;
  if (!result) return "Sin comandos.";
  return result.routers.map((router) => `Router ${router}:\n${result.commandsByRouter[router].join("\n")}`).join("\n\n");
}

function buildRouteTableText() {
  const result = state.lastRoutes;
  if (!result) return "Sin tabla de rutas.";
  return [
    "Router\tRed destino\tMáscara\tSiguiente salto\tExplicación",
    ...result.routes.map((route) => `${route.router}\t${route.network}\t${route.mask}\t${route.nextHop}\t${route.explanation}`)
  ].join("\n");
}

function ipToInt(ip) {
  const parts = ip.split(".");
  if (parts.length !== 4) throw new Error(`IP inválida: ${ip}`);
  const bytes = parts.map((part) => {
    if (!/^\d+$/.test(part)) throw new Error(`IP inválida: ${ip}`);
    const value = Number(part);
    if (value < 0 || value > 255) throw new Error(`IP inválida: ${ip}`);
    return value;
  });
  return (((bytes[0] << 24) >>> 0) + (bytes[1] << 16) + (bytes[2] << 8) + bytes[3]) >>> 0;
}

function intToIp(value) {
  return [
    (value >>> 24) & 255,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255
  ].join(".");
}

function normalizeCidr(value) {
  return Number(String(value).trim().replace("/", ""));
}

function cidrToMask(cidr) {
  if (!Number.isInteger(cidr) || cidr < 0 || cidr > 32) throw new Error("Máscara inválida.");
  const mask = cidr === 0 ? 0 : (0xffffffff << (32 - cidr)) >>> 0;
  return intToIp(mask);
}

function maskToCidr(mask) {
  const value = ipToInt(mask);
  const binary = value.toString(2).padStart(32, "0");
  if (!/^1*0*$/.test(binary)) throw new Error(`Máscara inválida: ${mask}`);
  return binary.indexOf("0") === -1 ? 32 : binary.indexOf("0");
}

function networkAddress(ipInt, cidr) {
  const mask = cidr === 0 ? 0 : (0xffffffff << (32 - cidr)) >>> 0;
  return (ipInt & mask) >>> 0;
}

function copyText(text) {
  if (!text) return toast("No hay texto para copiar");
  navigator.clipboard.writeText(text)
    .then(() => toast("Copiado al portapapeles"))
    .catch(() => toast("Safari requiere tocar de nuevo para copiar"));
}

function showError(selector, message) {
  const element = $(selector);
  element.textContent = message;
  element.hidden = false;
}

function clearError(selector) {
  const element = $(selector);
  element.textContent = "";
  element.hidden = true;
}

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("show");
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => element.classList.remove("show"), 2200);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    $("#pwaStatus").textContent = "Sin Service Worker";
    return;
  }
  navigator.serviceWorker.register("./service-worker.js")
    .then(() => {
      $("#pwaStatus").textContent = "Lista offline";
    })
    .catch(() => {
      $("#pwaStatus").textContent = "Offline no disponible";
    });
}
