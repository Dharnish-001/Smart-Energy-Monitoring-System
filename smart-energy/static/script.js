/* =====================================================
   VOLTGUARD IoT — SMART MULTI-HOUSE ENERGY MONITORING
   Production JavaScript Engine
   ===================================================== */
"use strict";

// =====================================================
// 1. CONFIGURATION & STATE MANAGEMENT
// =====================================================

const CONFIG = {
    tariff: 8.50,            // Electricity Tariff in INR (₹) per kWh
    updateInterval: 1500,    // Telemetry refresh interval in ms (1.5 seconds)
    historyLimit: 25,        // Live power chart rolling sample points
    currencySymbol: "₹"
};

const API_CONFIG = {
    baseUrl: (typeof window !== "undefined" && window.location && window.location.origin && window.location.origin !== "null")
        ? window.location.origin
        : "http://localhost:8000",
    endpoints: {
        health: "/api/health",
        dashboard: "/api/dashboard",
        energy: "/api/energy",       // POST /api/energy/{house_id}
        total: "/api/total",         // POST /api/total
        syncTelemetry: "/api/telemetry/sync",                   // Batch sync for 3 houses + total
        history: "/api/history",     // GET /api/history/{house_id}
        records: "/api/records",     // GET /api/records
        sendEmail: "/api/reports/send-email",                   // Endpoint for individual/combined report dispatch
        sendSeparateEmails: "/api/reports/send-separate-emails", // Batch endpoint for 3 separate house emails
        emailLogs: "/api/reports/email-logs",                   // Audit logs in SQLite
        schedule: "/api/reports/schedule"                       // Database-backed cron scheduling
    },
    timeoutMs: 4000
};

// House Telemetry Models
const houses = [
    {
        id: 1,
        name: "House 1",
        type: "Villa / Main Residence",
        color: "#06c6df",
        voltage: 231.8,
        current: 8.23,
        power: 1845.0,
        energy: 342.854,
        powerFactor: 0.97,
        frequency: 50.0,
        basePower: 1850.0,
        history: []
    },
    {
        id: 2,
        name: "House 2",
        type: "Urban Apartment (2BHK)",
        color: "#3984ff",
        voltage: 230.5,
        current: 4.28,
        power: 948.0,
        energy: 188.642,
        powerFactor: 0.96,
        frequency: 50.0,
        basePower: 950.0,
        history: []
    },
    {
        id: 3,
        name: "House 3",
        type: "Studio Flat / Annex",
        color: "#a78bfa",
        voltage: 232.2,
        current: 1.53,
        power: 348.0,
        energy: 94.281,
        powerFactor: 0.98,
        frequency: 50.0,
        basePower: 350.0,
        history: []
    }
];

// Multi-House Separate Email Dispatch Configuration
let houseEmails = {
    1: "villa.resident@voltguard.org",
    2: "apartment.resident@voltguard.org",
    3: "annex.resident@voltguard.org"
};
let managerEmail = "manager@voltguard.org";
let currentPreviewScope = "combined"; // "combined", 1, 2, or 3

// Runtime State
let powerChart = null;
let energyChart = null;
let simulationTimer = null;
let timeLabels = [];
let lastUpdateTime = Date.now();
let lastBackendSyncTime = 0;
const BACKEND_SYNC_INTERVAL_MS = 3000;
let backendConnected = false;
let currentPeriodFilter = "day";
let activeReport = null;
let reportHistory = [];
let schedulerConfig = {
    enabled: true,
    deliveryMode: "separate", // "separate", "manager", "both"
    recipientEmail: "manager@voltguard.org",
    deliveryDay: "1",
    deliveryTime: "09:00",
    reportingPeriod: "prev_calendar_month",
    format: "pdf",
    timezone: "Asia/Kolkata"
};

// =====================================================
// 2. MATHEMATICAL & FORMATTING UTILITIES
// =====================================================

function round(value, decimals = 2) {
    const factor = 10 ** decimals;
    return Math.round((value + Number.EPSILON) * factor) / factor;
}

function formatNumber(value, decimals = 2) {
    if (isNaN(value) || value === null || value === undefined) return "--";
    return Number(value).toLocaleString("en-IN", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    });
}

function getCurrentTime() {
    return new Date().toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true
    });
}

function getCurrentDate() {
    return new Date().toLocaleDateString("en-IN", {
        year: "numeric",
        month: "long",
        day: "numeric"
    });
}

function getCurrentDateTimeString() {
    return `${getCurrentDate()} at ${getCurrentTime()}`;
}

// Single-Phase Cost calculation: Cost (₹) = Energy (kWh) × Tariff (₹/kWh)
function calculateCost(energyKWh, tariff = CONFIG.tariff) {
    return round(energyKWh * tariff, 2);
}

// Single-Phase AC Current calculation: Current (A) = Power (W) / (Voltage (V) × Power Factor)
function calculateCurrent(powerW, voltageV, powerFactor) {
    if (voltageV <= 0 || powerFactor <= 0) return 0;
    return round(powerW / (voltageV * powerFactor), 2);
}

// Single-Phase AC Energy Accumulation: Energy (kWh) = Power (W) × Elapsed Hours / 1000
function calculateAccumulatedEnergy(powerW, elapsedHours) {
    return (powerW * elapsedHours) / 1000;
}

// =====================================================
// 3. SIMULATION & TELEMETRY ENGINE
// =====================================================

function simulateReadings() {
    const now = Date.now();
    const elapsedHours = Math.max(0, (now - lastUpdateTime) / 3600000);
    lastUpdateTime = now;

    houses.forEach(house => {
        // Voltage fluctuating realistically between 224V and 238V
        const voltageDrift = (Math.random() - 0.5) * 0.8;
        house.voltage = round(Math.min(238, Math.max(224, house.voltage + voltageDrift)), 1);

        // Power fluctuating around base load ±10%
        const powerJitter = (Math.random() - 0.5) * 0.12;
        house.power = round(Math.max(50, house.basePower * (1 + powerJitter)), 1);

        // Power factor realistic inductive load: 0.92 to 0.99
        house.powerFactor = round(0.92 + Math.random() * 0.07, 2);

        // Grid frequency: 49.85 Hz to 50.15 Hz
        house.frequency = round(49.85 + Math.random() * 0.25, 2);

        // Strictly consistent single-phase relationship: I = P / (V × PF)
        house.current = calculateCurrent(house.power, house.voltage, house.powerFactor);

        // Continuous energy accumulation
        const addedEnergy = calculateAccumulatedEnergy(house.power, elapsedHours);
        house.energy = round(house.energy + addedEnergy, 5);

        // Record history snapshot
        house.history.push({
            time: getCurrentTime(),
            power: house.power,
            voltage: house.voltage,
            current: house.current,
            energy: house.energy,
            pf: house.powerFactor,
            frequency: house.frequency
        });

        if (house.history.length > CONFIG.historyLimit) {
            house.history.shift();
        }
    });
}

function updateHouseCards() {
    houses.forEach((house, index) => {
        const prefix = `house${index + 1}`;
        const voltageEl = document.getElementById(`${prefix}Voltage`);
        const currentEl = document.getElementById(`${prefix}Current`);
        const powerEl = document.getElementById(`${prefix}Power`);
        const energyEl = document.getElementById(`${prefix}Energy`);
        const frequencyEl = document.getElementById(`${prefix}Frequency`);
        const pfEl = document.getElementById(`${prefix}PF`);
        const costEl = document.getElementById(`${prefix}Cost`);
        const rateEl = document.getElementById(`${prefix}CostRate`);
        const updatedEl = document.getElementById(`${prefix}Updated`);

        if (voltageEl) voltageEl.textContent = `${formatNumber(house.voltage, 1)} V`;
        if (currentEl) currentEl.textContent = `${formatNumber(house.current, 2)} A`;
        if (powerEl) powerEl.textContent = `${formatNumber(house.power, 0)} W`;
        if (energyEl) energyEl.textContent = `${formatNumber(house.energy, 3)} kWh`;
        if (frequencyEl) frequencyEl.textContent = `${formatNumber(house.frequency, 1)} Hz`;
        if (pfEl) pfEl.textContent = `${formatNumber(house.powerFactor, 2)} PF`;
        if (costEl) costEl.textContent = `₹${formatNumber(calculateCost(house.energy), 2)}`;
        if (rateEl) rateEl.textContent = `@ ₹${formatNumber(CONFIG.tariff, 2)} / kWh`;
        if (updatedEl) updatedEl.textContent = getCurrentTime();
    });

    const lastUpdatedGlobal = document.getElementById("lastUpdated");
    if (lastUpdatedGlobal) {
        lastUpdatedGlobal.textContent = `Last telemetry sync: ${getCurrentTime()}`;
    }
}

function updateLiveTelemetryStrip() {
    const h1 = houses[0];
    const h2 = houses[1];
    const h3 = houses[2];
    const totalPower = h1.power + h2.power + h3.power;

    const sH1 = document.getElementById("stripH1Power");
    const sH2 = document.getElementById("stripH2Power");
    const sH3 = document.getElementById("stripH3Power");
    const sTot = document.getElementById("stripTotalPower");

    if (sH1) sH1.textContent = `${formatNumber(h1.power, 0)} W`;
    if (sH2) sH2.textContent = `${formatNumber(h2.power, 0)} W`;
    if (sH3) sH3.textContent = `${formatNumber(h3.power, 0)} W`;
    if (sTot) sTot.textContent = `${formatNumber(totalPower, 0)} W`;
}

function updateHouseComparison() {
    const container = document.getElementById("houseComparisonList");
    if (!container) return;

    const totalEnergy = houses.reduce((sum, h) => sum + h.energy, 0);
    const totalCost = houses.reduce((sum, h) => sum + calculateCost(h.energy), 0);
    const sorted = [...houses].sort((a, b) => b.energy - a.energy);
    const maxEnergy = Math.max(...houses.map(h => h.energy), 1);

    container.innerHTML = sorted.map((house, rankIndex) => {
        const percentage = totalEnergy > 0 ? (house.energy / totalEnergy) * 100 : 0;
        const barWidth = (house.energy / maxEnergy) * 100;
        const colorClass = house.id === 1 ? "house-one" : house.id === 2 ? "house-two" : "house-three";

        return `
            <div class="comparison-row">
                <div class="comparison-row-header">
                    <span class="comparison-house-name">${house.name} — ${house.type}</span>
                    <span class="comparison-house-value">${formatNumber(house.energy, 3)} kWh (${formatNumber(percentage, 1)}%)</span>
                </div>
                <div class="comparison-track">
                    <div class="comparison-bar ${colorClass}" style="width: ${barWidth}%"></div>
                </div>
                <div class="comparison-row-footer">
                    <span>Rank #${rankIndex + 1}</span>
                    <span>Estimated Bill: <strong>₹${formatNumber(calculateCost(house.energy), 2)}</strong></span>
                </div>
            </div>
        `;
    }).join("");

    // Update combined total displays
    const combEnergyEl = document.getElementById("combinedEnergy");
    const combCostEl = document.getElementById("combinedCost");
    const combTariffEl = document.getElementById("combinedTariffSummary");

    if (combEnergyEl) combEnergyEl.textContent = `${formatNumber(totalEnergy, 3)} kWh`;
    if (combCostEl) combCostEl.textContent = `₹${formatNumber(totalCost, 2)}`;
    if (combTariffEl) combTariffEl.textContent = `Tariff: ₹${formatNumber(CONFIG.tariff, 2)} / kWh`;

    // Consumer Extremes callouts
    const highest = sorted[0];
    const lowest = sorted[sorted.length - 1];

    const highNameEl = document.getElementById("highestConsumerName");
    const lowNameEl = document.getElementById("lowestConsumerName");

    if (highNameEl) {
        const highPct = totalEnergy > 0 ? (highest.energy / totalEnergy) * 100 : 0;
        highNameEl.textContent = `${highest.name} (${formatNumber(highPct, 1)}%)`;
    }
    if (lowNameEl) {
        const lowPct = totalEnergy > 0 ? (lowest.energy / totalEnergy) * 100 : 0;
        lowNameEl.textContent = `${lowest.name} (${formatNumber(lowPct, 1)}%)`;
    }
}

// =====================================================
// 4. CHART.JS VISUALIZATIONS
// =====================================================

function initializePowerChart() {
    const canvas = document.getElementById("powerComparisonChart");
    if (!canvas || typeof Chart === "undefined") {
        console.warn("Chart.js is not loaded or canvas missing.");
        return;
    }

    powerChart = new Chart(canvas.getContext("2d"), {
        type: "line",
        data: {
            labels: [],
            datasets: houses.map(h => ({
                label: `${h.name} (${h.type})`,
                data: [],
                borderColor: h.color,
                backgroundColor: h.color + "14",
                borderWidth: 2,
                pointRadius: 2,
                pointHoverRadius: 5,
                tension: 0.35,
                fill: true
            }))
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            interaction: {
                mode: "index",
                intersect: false
            },
            plugins: {
                legend: {
                    display: false // Using custom top badges
                },
                tooltip: {
                    backgroundColor: "rgba(11, 18, 32, 0.95)",
                    titleColor: "#edf4ff",
                    bodyColor: "#91a0b6",
                    borderColor: "#23324a",
                    borderWidth: 1,
                    padding: 10,
                    boxPadding: 4,
                    callbacks: {
                        label: function (context) {
                            return ` ${context.dataset.label.split(" (")[0]}: ${formatNumber(context.parsed.y, 0)} W`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    ticks: {
                        color: "#627289",
                        maxTicksLimit: 7,
                        font: { family: "'JetBrains Mono', monospace", size: 10 }
                    },
                    grid: { color: "rgba(145, 160, 182, 0.06)" }
                },
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: "Active Power (Watts)",
                        color: "#91a0b6",
                        font: { size: 11, weight: "600" }
                    },
                    ticks: {
                        color: "#627289",
                        font: { family: "'JetBrains Mono', monospace", size: 10 }
                    },
                    grid: { color: "rgba(145, 160, 182, 0.06)" }
                }
            }
        }
    });
}

function initializeEnergyChart() {
    const canvas = document.getElementById("energyComparisonChart");
    if (!canvas || typeof Chart === "undefined") return;

    energyChart = new Chart(canvas.getContext("2d"), {
        type: "bar",
        data: {
            labels: houses.map(h => h.name),
            datasets: [{
                label: "Energy Consumption (kWh)",
                data: houses.map(h => h.energy),
                backgroundColor: houses.map(h => h.color),
                borderRadius: 8,
                maxBarThickness: 55
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: "rgba(11, 18, 32, 0.95)",
                    borderColor: "#23324a",
                    borderWidth: 1,
                    callbacks: {
                        label: function (ctx) {
                            const val = ctx.parsed.y;
                            const cost = calculateCost(val);
                            return ` Energy: ${formatNumber(val, 3)} kWh | Est. Cost: ₹${formatNumber(cost, 2)}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    ticks: { color: "#91a0b6", font: { weight: "600" } },
                    grid: { display: false }
                },
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: "Accumulated Energy (kWh)",
                        color: "#91a0b6",
                        font: { size: 11, weight: "600" }
                    },
                    ticks: {
                        color: "#627289",
                        font: { family: "'JetBrains Mono', monospace", size: 10 }
                    },
                    grid: { color: "rgba(145, 160, 182, 0.06)" }
                }
            }
        }
    });
}

function updateCharts() {
    const label = getCurrentTime();
    timeLabels.push(label);
    if (timeLabels.length > CONFIG.historyLimit) {
        timeLabels.shift();
    }

    if (powerChart) {
        powerChart.data.labels = [...timeLabels];
        houses.forEach((house, i) => {
            if (!powerChart.data.datasets[i]) return;
            powerChart.data.datasets[i].data.push(house.power);
            if (powerChart.data.datasets[i].data.length > CONFIG.historyLimit) {
                powerChart.data.datasets[i].data.shift();
            }
        });
        powerChart.update("none");
    }

    if (energyChart) {
        // Multiplier based on period selection
        let multiplier = 1;
        if (currentPeriodFilter === "month") multiplier = 1.0;
        else if (currentPeriodFilter === "day") multiplier = 0.035; // Fraction of cumulative
        else if (currentPeriodFilter === "prev_month") multiplier = 0.92;

        energyChart.data.datasets[0].data = houses.map(h => round(h.energy * multiplier, 3));
        energyChart.update("none");
    }
}

function updateDashboard() {
    updateHouseCards();
    updateLiveTelemetryStrip();
    updateHouseComparison();
    updateCharts();
}

async function syncTelemetryToBackend() {
    if (!backendConnected) return;
    try {
        const payload = {
            houses: houses.map(h => ({
                house_id: h.id,
                voltage: h.voltage,
                current: h.current,
                power: h.power,
                energy: h.energy,
                frequency: h.frequency,
                pf: h.powerFactor,
                cost: calculateCost(h.energy)
            })),
            total: {
                power: houses.reduce((sum, h) => sum + h.power, 0),
                energy: houses.reduce((sum, h) => sum + h.energy, 0),
                cost: houses.reduce((sum, h) => sum + calculateCost(h.energy), 0)
            }
        };

        await fetch(API_CONFIG.baseUrl + API_CONFIG.endpoints.syncTelemetry, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
    } catch (err) {
        console.warn("Backend telemetry sync failed:", err);
    }
}

async function fetchBackendInitialState() {
    if (!backendConnected) return;
    try {
        const res = await fetch(API_CONFIG.baseUrl + API_CONFIG.endpoints.dashboard);
        if (res.ok) {
            const data = await res.json();
            if (data.houses && data.houses.length > 0) {
                data.houses.forEach(serverH => {
                    const localH = houses.find(h => h.id === serverH.house_id);
                    if (localH) {
                        localH.voltage = serverH.voltage;
                        localH.current = serverH.current;
                        localH.power = serverH.power;
                        localH.energy = serverH.energy;
                        localH.frequency = serverH.frequency;
                        localH.powerFactor = serverH.pf;
                    }
                });
                updateDashboard();
            }
        }
    } catch (err) {
        console.warn("Could not fetch initial backend state:", err);
    }
}

function startSimulation() {
    if (simulationTimer) clearInterval(simulationTimer);
    lastUpdateTime = Date.now();
    simulationTimer = setInterval(async () => {
        simulateReadings();
        updateDashboard();

        // If connected to FastAPI backend, persist live telemetry into SQLite energy.db every 3 seconds
        const now = Date.now();
        if (backendConnected && (now - lastBackendSyncTime >= BACKEND_SYNC_INTERVAL_MS)) {
            lastBackendSyncTime = now;
            await syncTelemetryToBackend();
        }
    }, CONFIG.updateInterval);
}

// =====================================================
// 5. PERIOD FILTER LOGIC
// =====================================================

function initializePeriodFilters() {
    const buttons = document.querySelectorAll(".period-btn");
    const customBar = document.getElementById("customRangeBar");
    const noteEl = document.getElementById("periodDisclaimerNote");

    buttons.forEach(btn => {
        btn.addEventListener("click", () => {
            buttons.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");

            currentPeriodFilter = btn.dataset.period;

            if (currentPeriodFilter === "custom") {
                if (customBar) customBar.hidden = false;
                if (noteEl) noteEl.textContent = "ℹ Custom date range selected. Filter will compute metrics from persisted database records if available.";
            } else {
                if (customBar) customBar.hidden = true;
                if (currentPeriodFilter === "day") {
                    if (noteEl) noteEl.textContent = "ℹ Showing real-time accumulated session energy. Accruing live from simulated active loads.";
                } else if (currentPeriodFilter === "month") {
                    if (noteEl) noteEl.textContent = "ℹ Showing month-to-date simulated accumulation. Synced with active single-phase load profiles.";
                } else if (currentPeriodFilter === "prev_month") {
                    if (noteEl) noteEl.textContent = "ℹ Showing previous month baseline comparison. Stored historical database records needed for calendar variance.";
                }
            }

            if (energyChart) energyChart.update();
        });
    });

    const applyRangeBtn = document.getElementById("btnApplyCustomRange");
    if (applyRangeBtn) {
        applyRangeBtn.addEventListener("click", () => {
            const start = document.getElementById("customStartDate")?.value;
            const end = document.getElementById("customEndDate")?.value;
            if (!start || !end) {
                showToast("Please choose both a start and end date.", "error");
                return;
            }
            if (new Date(start) > new Date(end)) {
                showToast("Start date cannot be after end date.", "error");
                return;
            }
            showToast(`Custom range applied: ${start} to ${end}.`, "info");
        });
    }
}

// =====================================================
// 6. MONTHLY ENERGY REPORTS GENERATION & PREVIEW (PANELS A, B, C, D)
// =====================================================

function getMonthName(monthIndex) {
    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    return months[Number(monthIndex)] || "Current Month";
}

function loadHouseEmails() {
    try {
        const stored = localStorage.getItem("voltguard_house_emails");
        if (stored) {
            const parsed = JSON.parse(stored);
            houseEmails = { ...houseEmails, ...parsed };
        }
    } catch (e) {
        console.error("Error reading house emails:", e);
    }

    const h1 = document.getElementById("reportHouse1Email");
    const h2 = document.getElementById("reportHouse2Email");
    const h3 = document.getElementById("reportHouse3Email");
    const mgr = document.getElementById("reportRecipientEmail");

    if (h1 && houseEmails[1]) h1.value = houseEmails[1];
    if (h2 && houseEmails[2]) h2.value = houseEmails[2];
    if (h3 && houseEmails[3]) h3.value = houseEmails[3];
    if (mgr && mgr.value) managerEmail = mgr.value.trim();

    updateSchedulerRecipientTags();
}

function saveHouseEmails() {
    const h1 = document.getElementById("reportHouse1Email")?.value.trim();
    const h2 = document.getElementById("reportHouse2Email")?.value.trim();
    const h3 = document.getElementById("reportHouse3Email")?.value.trim();
    const mgr = document.getElementById("reportRecipientEmail")?.value.trim();

    if (h1) houseEmails[1] = h1;
    if (h2) houseEmails[2] = h2;
    if (h3) houseEmails[3] = h3;
    if (mgr) managerEmail = mgr;

    try {
        localStorage.setItem("voltguard_house_emails", JSON.stringify(houseEmails));
    } catch (e) {
        console.error("Error saving house emails:", e);
    }
}

function updateSchedulerRecipientTags() {
    const t1 = document.getElementById("schedTagH1");
    const t2 = document.getElementById("schedTagH2");
    const t3 = document.getElementById("schedTagH3");
    if (t1) t1.textContent = houseEmails[1] || "villa.resident@voltguard.org";
    if (t2) t2.textContent = houseEmails[2] || "apartment.resident@voltguard.org";
    if (t3) t3.textContent = houseEmails[3] || "annex.resident@voltguard.org";
}

function buildHouseReportData(houseId, baseReport = null) {
    const parentReport = baseReport || buildReportData();
    const house = houses.find(h => h.id === Number(houseId)) || houses[0];
    const email = houseEmails[house.id] || `house${house.id}.resident@voltguard.org`;
    const tariffVal = parentReport.tariff;
    const cost = round(calculateCost(house.energy, tariffVal), 2);
    const totalEnergy = parentReport.totalEnergy;
    const pct = totalEnergy > 0 ? round((house.energy / totalEnergy) * 100, 1) : 0;

    return {
        id: `VG-RPT-H${house.id}-${parentReport.id.split("-").slice(2).join("-")}`,
        parentReportId: parentReport.id,
        isIndividualHouse: true,
        houseId: house.id,
        houseName: house.name,
        houseType: house.type,
        houseColor: house.color,
        period: parentReport.period,
        generatedAt: parentReport.generatedAt,
        generatedDateDisplay: parentReport.generatedDateDisplay,
        tariff: tariffVal,
        format: parentReport.format,
        recipientEmail: email,
        ccEmails: parentReport.ccEmails,
        totalEnergy: round(house.energy, 3),
        totalCost: cost,
        estateTotalEnergy: totalEnergy,
        estateTotalCost: parentReport.totalCost,
        percentageOfEstate: pct,
        highestConsumer: parentReport.highestConsumer,
        lowestConsumer: parentReport.lowestConsumer,
        housesData: [
            {
                id: house.id,
                name: house.name,
                type: house.type,
                voltage: house.voltage,
                current: house.current,
                power: house.power,
                energy: round(house.energy, 3),
                frequency: house.frequency,
                powerFactor: house.powerFactor,
                cost: cost,
                percentage: pct
            }
        ],
        telemetry: {
            voltage: house.voltage,
            current: house.current,
            power: house.power,
            energy: round(house.energy, 3),
            frequency: house.frequency,
            powerFactor: house.powerFactor,
            cost: cost
        },
        status: "Draft",
        deliveryLog: `Individual resident statement created for ${house.name} (${email}).`
    };
}

function buildReportData() {
    const periodSelect = document.getElementById("reportPeriodSelect")?.value || "current_month";
    const monthIndex = document.getElementById("reportMonthSelect")?.value || "9";
    const year = document.getElementById("reportYearSelect")?.value || "2026";
    saveHouseEmails();
    const recipientEmail = managerEmail || "manager@voltguard.org";
    const ccEmails = document.getElementById("reportCcEmails")?.value.trim() || "";
    const tariffVal = parseFloat(document.getElementById("reportTariffInput")?.value) || CONFIG.tariff;
    const format = document.querySelector('input[name="reportFormat"]:checked')?.value || "pdf";

    // Update global tariff if changed
    CONFIG.tariff = tariffVal;

    let periodLabel = `${getMonthName(monthIndex)} ${year}`;
    if (periodSelect === "session_total") {
        periodLabel = `Session Live (${getCurrentDate()})`;
    } else if (periodSelect === "previous_month") {
        const prevMonth = (Number(monthIndex) + 11) % 12;
        periodLabel = `${getMonthName(prevMonth)} ${Number(monthIndex) === 0 ? Number(year) - 1 : year}`;
    }

    const totalEnergy = houses.reduce((sum, h) => sum + h.energy, 0);
    const totalCost = houses.reduce((sum, h) => sum + calculateCost(h.energy, tariffVal), 0);
    const sorted = [...houses].sort((a, b) => b.energy - a.energy);
    const highest = sorted[0];
    const lowest = sorted[sorted.length - 1];

    const reportId = `VG-RPT-${year}${(Number(monthIndex) + 1).toString().padStart(2, "0")}-${Math.floor(100 + Math.random() * 900)}`;

    return {
        id: reportId,
        period: periodLabel,
        generatedAt: new Date().toISOString(),
        generatedDateDisplay: getCurrentDateTimeString(),
        tariff: tariffVal,
        format: format,
        recipientEmail: recipientEmail,
        houseEmails: { ...houseEmails },
        ccEmails: ccEmails,
        totalEnergy: round(totalEnergy, 3),
        totalCost: round(totalCost, 2),
        highestConsumer: highest,
        lowestConsumer: lowest,
        housesData: houses.map(h => ({
            id: h.id,
            name: h.name,
            type: h.type,
            voltage: h.voltage,
            current: h.current,
            power: h.power,
            energy: round(h.energy, 3),
            frequency: h.frequency,
            powerFactor: h.powerFactor,
            cost: round(calculateCost(h.energy, tariffVal), 2),
            percentage: totalEnergy > 0 ? round((h.energy / totalEnergy) * 100, 1) : 0
        })),
        status: "Draft",
        deliveryLog: "Report created in local memory."
    };
}

function updatePanelBSummary(report) {
    const periodLabelEl = document.getElementById("summaryPeriodLabel");
    const tariffLabelEl = document.getElementById("summaryTariffLabel");
    const totalEnergyEl = document.getElementById("summaryTotalEnergy");
    const totalCostEl = document.getElementById("summaryTotalCost");
    const highestEl = document.getElementById("summaryHighestConsumer");
    const lowestEl = document.getElementById("summaryLowestConsumer");
    const tableBody = document.getElementById("summaryTableBody");

    if (periodLabelEl) periodLabelEl.textContent = report.period;
    if (tariffLabelEl) tariffLabelEl.textContent = `Tariff: ₹${formatNumber(report.tariff, 2)} / kWh`;
    if (totalEnergyEl) totalEnergyEl.textContent = `${formatNumber(report.totalEnergy, 3)} kWh`;
    if (totalCostEl) totalCostEl.textContent = `₹${formatNumber(report.totalCost, 2)}`;

    if (highestEl) {
        highestEl.textContent = `${report.highestConsumer.name} — ${report.highestConsumer.type} (${formatNumber(report.highestConsumer.percentage || 0, 1)}%)`;
    }
    if (lowestEl) {
        lowestEl.textContent = `${report.lowestConsumer.name} — ${report.lowestConsumer.type} (${formatNumber(report.lowestConsumer.percentage || 0, 1)}%)`;
    }

    if (tableBody) {
        tableBody.innerHTML = report.housesData.map(h => `
            <tr>
                <td><strong>${h.name}</strong></td>
                <td>${h.type}</td>
                <td><strong>${formatNumber(h.energy, 3)}</strong></td>
                <td>${formatNumber(h.percentage, 1)}%</td>
                <td><strong>₹${formatNumber(h.cost, 2)}</strong></td>
            </tr>
        `).join("");
    }
}

function updatePanelCPreview(report, scope = currentPreviewScope) {
    if (!report) return;

    const docIdEl = document.getElementById("docReportId");
    const docDateEl = document.getElementById("docGeneratedDate");
    const docPeriodEl = document.getElementById("docPeriodText");
    const docTariffEl = document.getElementById("docTariffText");
    const kpiEnergyEl = document.getElementById("docKpiEnergy");
    const kpiCostEl = document.getElementById("docKpiCost");
    const kpiHighEl = document.getElementById("docKpiHighest");
    const kpiHighPctEl = document.getElementById("docKpiHighestPct");
    const kpiLowEl = document.getElementById("docKpiLowest");
    const kpiLowPctEl = document.getElementById("docKpiLowestPct");
    const tableBody = document.getElementById("docTelemetryTableBody");
    const barsContainer = document.getElementById("docVisualBars");
    const recipientEl = document.getElementById("docRecipientsList");
    const docTitle = document.querySelector(".doc-title");
    const docSubtitle = document.querySelector(".doc-subtitle");

    // Check if viewing individual house statement
    if (scope !== "combined" && (scope === "1" || scope === "2" || scope === "3" || typeof scope === "number")) {
        const houseId = Number(scope);
        const houseData = (report.housesData && report.housesData.find(h => h.id === houseId)) ||
                          (report.houseId === houseId ? report : null) || houses[houseId - 1];
        const email = houseEmails[houseId] || "resident@voltguard.org";
        const cost = round(calculateCost(houseData.energy, report.tariff), 2);
        const totalEstateEnergy = report.totalEnergy || houses.reduce((s, h) => s + h.energy, 0);
        const pct = totalEstateEnergy > 0 ? round((houseData.energy / totalEstateEnergy) * 100, 1) : 33.3;

        if (docTitle) docTitle.textContent = `VOLTGUARD IoT — RESIDENTIAL ELECTRICITY STATEMENT`;
        if (docSubtitle) docSubtitle.textContent = `Individual Metering Statement · ${houseData.name} (${houseData.type})`;

        if (docIdEl) docIdEl.textContent = `VG-STMT-H${houseId}-${(report.id || "").split("-").slice(-2).join("-") || "001"}`;
        if (docDateEl) docDateEl.textContent = report.generatedDateDisplay || getCurrentDateTimeString();
        if (docPeriodEl) docPeriodEl.textContent = report.period || "Current Month";
        if (docTariffEl) docTariffEl.textContent = `₹${formatNumber(report.tariff, 2)} per kWh`;

        if (kpiEnergyEl) kpiEnergyEl.textContent = `${formatNumber(houseData.energy, 3)} kWh`;
        if (kpiCostEl) kpiCostEl.textContent = `₹${formatNumber(cost, 2)}`;
        if (kpiHighEl) kpiHighEl.textContent = `${formatNumber(houseData.power, 0)} W (PF ${formatNumber(houseData.powerFactor, 2)})`;
        if (kpiHighPctEl) kpiHighPctEl.textContent = `Active Load & Power Factor`;
        if (kpiLowEl) kpiLowEl.textContent = `${pct}% of Estate`;
        if (kpiLowPctEl) kpiLowPctEl.textContent = `Proportion of 3-house load`;

        if (tableBody) {
            tableBody.innerHTML = `
                <tr>
                    <td><strong>${houseData.name}</strong></td>
                    <td>${houseData.type}</td>
                    <td>${formatNumber(houseData.voltage, 1)} V</td>
                    <td>${formatNumber(houseData.current, 2)} A</td>
                    <td>${formatNumber(houseData.power, 0)} W</td>
                    <td>${formatNumber(houseData.frequency, 1)} Hz</td>
                    <td>${formatNumber(houseData.powerFactor, 2)}</td>
                    <td><strong>${formatNumber(houseData.energy, 3)} kWh</strong></td>
                    <td><strong>₹${formatNumber(cost, 2)}</strong></td>
                </tr>
            ` + `
                <tfoot>
                    <tr>
                        <td colspan="7"><strong>NET ELECTRICITY CHARGES PAYABLE (${houseData.name.toUpperCase()})</strong></td>
                        <td><strong>${formatNumber(houseData.energy, 3)} kWh</strong></td>
                        <td><strong style="color:var(--cyan); font-size:14px;">₹${formatNumber(cost, 2)}</strong></td>
                    </tr>
                </tfoot>
            `;
        }

        if (barsContainer) {
            barsContainer.innerHTML = `
                <div style="margin-bottom: 8px;">
                    <div style="display:flex; justify-content:space-between; font-size:11px; margin-bottom:4px;">
                        <span><strong>${houseData.name} Individual Share</strong> (${houseData.type})</span>
                        <span><strong>${formatNumber(houseData.energy, 3)} kWh</strong> (${pct}%) · ₹${formatNumber(cost, 2)}</span>
                    </div>
                    <div style="width:100%; height:10px; background:#09101d; border-radius:5px; overflow:hidden;">
                        <div style="width:${pct}%; height:100%; background:${houseData.id === 1 ? 'var(--cyan)' : houseData.id === 2 ? 'var(--blue)' : 'var(--purple)'}; border-radius:5px;"></div>
                    </div>
                    <p style="margin-top:6px; font-size:11px; color:var(--text-muted);">
                        Estate Total: ${formatNumber(totalEstateEnergy, 3)} kWh across 3 monitored residences.
                    </p>
                </div>
            `;
        }

        if (recipientEl) {
            recipientEl.innerHTML = `<strong>${email}</strong> <span style="color:var(--cyan);">(Dedicated Resident Mailbox)</span>`;
        }
        return;
    }

    // Default: Combined 3-House Overview
    if (docTitle) docTitle.textContent = `VOLTGUARD IoT — RESIDENTIAL ENERGY REPORT`;
    if (docSubtitle) docSubtitle.textContent = `Smart Multi-House Telemetry & Electricity Cost Analysis`;

    if (docIdEl) docIdEl.textContent = report.id;
    if (docDateEl) docDateEl.textContent = report.generatedDateDisplay;
    if (docPeriodEl) docPeriodEl.textContent = report.period;
    if (docTariffEl) docTariffEl.textContent = `₹${formatNumber(report.tariff, 2)} per kWh`;

    if (kpiEnergyEl) kpiEnergyEl.textContent = `${formatNumber(report.totalEnergy, 3)} kWh`;
    if (kpiCostEl) kpiCostEl.textContent = `₹${formatNumber(report.totalCost, 2)}`;

    if (kpiHighEl) kpiHighEl.textContent = `${report.highestConsumer ? report.highestConsumer.name : 'House 1'} (${(report.highestConsumer ? report.highestConsumer.type : '').split(" /")[0]})`;
    if (kpiHighPctEl) kpiHighPctEl.textContent = `${formatNumber(report.highestConsumer ? report.highestConsumer.percentage : 0, 1)}% of total residential load`;

    if (kpiLowEl) kpiLowEl.textContent = `${report.lowestConsumer ? report.lowestConsumer.name : 'House 3'} (${(report.lowestConsumer ? report.lowestConsumer.type : '').split(" /")[0]})`;
    if (kpiLowPctEl) kpiLowPctEl.textContent = `${formatNumber(report.lowestConsumer ? report.lowestConsumer.percentage : 0, 1)}% of total residential load`;

    if (tableBody) {
        tableBody.innerHTML = (report.housesData || houses).map(h => `
            <tr>
                <td><strong>${h.name}</strong></td>
                <td>${h.type}</td>
                <td>${formatNumber(h.voltage, 1)} V</td>
                <td>${formatNumber(h.current, 2)} A</td>
                <td>${formatNumber(h.power, 0)} W</td>
                <td>${formatNumber(h.frequency, 1)} Hz</td>
                <td>${formatNumber(h.powerFactor, 2)}</td>
                <td><strong>${formatNumber(h.energy, 3)} kWh</strong></td>
                <td><strong>₹${formatNumber(h.cost, 2)}</strong></td>
            </tr>
        `).join("") + `
            <tfoot>
                <tr>
                    <td colspan="7"><strong>COMBINED SYSTEM TOTALS (3 HOUSES)</strong></td>
                    <td><strong>${formatNumber(report.totalEnergy, 3)} kWh</strong></td>
                    <td><strong>₹${formatNumber(report.totalCost, 2)}</strong></td>
                </tr>
            </tfoot>
        `;
    }

    if (barsContainer) {
        barsContainer.innerHTML = (report.housesData || houses).map(h => {
            const color = h.id === 1 ? "var(--cyan)" : h.id === 2 ? "var(--blue)" : "var(--purple)";
            return `
                <div style="margin-bottom: 6px;">
                    <div style="display:flex; justify-content:space-between; font-size:11px; margin-bottom:4px;">
                        <span><strong>${h.name}</strong> (${h.type})</span>
                        <span><strong>${formatNumber(h.energy, 3)} kWh</strong> (${formatNumber(h.percentage, 1)}%) · ₹${formatNumber(h.cost, 2)}</span>
                    </div>
                    <div style="width:100%; height:8px; background:#09101d; border-radius:4px; overflow:hidden;">
                        <div style="width:${h.percentage}%; height:100%; background:${color}; border-radius:4px;"></div>
                    </div>
                </div>
            `;
        }).join("");
    }

    if (recipientEl) {
        recipientEl.innerHTML = `Separate: <strong>H1 (${houseEmails[1]})</strong>, <strong>H2 (${houseEmails[2]})</strong>, <strong>H3 (${houseEmails[3]})</strong> | Manager (${managerEmail})`;
    }
}

function generateReport(silent = false) {
    activeReport = buildReportData();
    updatePanelBSummary(activeReport);
    updatePanelCPreview(activeReport);

    // Save report in history if not already present
    const existingIndex = reportHistory.findIndex(r => r.id === activeReport.id);
    if (existingIndex >= 0) {
        reportHistory[existingIndex] = activeReport;
    } else {
        reportHistory.unshift(activeReport);
    }
    saveReportHistory();
    renderReportHistoryTable();

    if (!silent) {
        showFeedbackBox("Report generated successfully. Review Summary & Preview below.", "success");
        showToast(`Report ${activeReport.id} generated.`, "info");
    }

    return activeReport;
}

// =====================================================
// 7. PDF & CSV DOWNLOAD LOGIC
// =====================================================

function downloadCSV() {
    if (!activeReport) {
        activeReport = generateReport(true);
    }

    if (currentPreviewScope !== "combined") {
        const houseId = Number(currentPreviewScope);
        const single = buildHouseReportData(houseId, activeReport);
        const headers = ["Metric", "Description", "Value", "Units"];
        const dataRows = [
            ["House Name", single.houseName, single.houseName, ""],
            ["Classification", single.houseType, single.houseType, ""],
            ["Billing Period", single.period, single.period, ""],
            ["Resident Recipient", single.recipientEmail, single.recipientEmail, ""],
            ["AC Voltage", "Single-Phase Voltage", single.telemetry.voltage.toFixed(1), "V"],
            ["Operating Current", "Load Current", single.telemetry.current.toFixed(2), "A"],
            ["Active Power", "Real Power Demand", single.telemetry.power.toFixed(1), "W"],
            ["Grid Frequency", "AC Frequency", single.telemetry.frequency.toFixed(1), "Hz"],
            ["Power Factor", "Power Factor (cos phi)", single.telemetry.powerFactor.toFixed(2), "PF"],
            ["Accumulated Energy", "Meter Reading", single.totalEnergy.toFixed(3), "kWh"],
            ["Electricity Tariff", "Applied Rate", single.tariff.toFixed(2), "INR/kWh"],
            ["Total Net Payable", "Electricity Bill Amount", single.totalCost.toFixed(2), "INR"],
            ["Estate Proportion", "Share of 3-house estate", single.percentageOfEstate.toFixed(1), "%"]
        ];

        const metadataRows = [
            `"VOLTGUARD IoT - INDIVIDUAL RESIDENTIAL ELECTRICITY STATEMENT"`,
            `"Statement ID: ${single.id}"`,
            `"Generated At: ${single.generatedDateDisplay}"`,
            `"Resident Mailbox: ${single.recipientEmail}"`,
            `"Disclaimer: Mathematically calculated single-phase load readings (P = V x I x PF)"`,
            `""`
        ];

        const csvContent = [
            ...metadataRows,
            headers.join(","),
            ...dataRows.map(r => r.map(c => `"${c}"`).join(","))
        ].join("\r\n");

        const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        const filename = `VoltGuard_Statement_House_${houseId}_${activeReport.period.replace(/[\s\/]/g, "_")}.csv`;

        link.setAttribute("href", url);
        link.setAttribute("download", filename);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        showToast(`Downloaded CSV statement for ${single.houseName}.`, "success");
        return;
    }

    const headers = [
        "House Name",
        "House Classification",
        "Reporting Period",
        "Average Voltage (V)",
        "Average Current (A)",
        "Active Power (W)",
        "Energy Consumption (kWh)",
        "Frequency (Hz)",
        "Power Factor (PF)",
        "Electricity Tariff (INR/kWh)",
        "Estimated Cost (INR)"
    ];

    const dataRows = activeReport.housesData.map(h => [
        `"${h.name}"`,
        `"${h.type}"`,
        `"${activeReport.period}"`,
        h.voltage.toFixed(1),
        h.current.toFixed(2),
        h.power.toFixed(1),
        h.energy.toFixed(5),
        h.frequency.toFixed(1),
        h.powerFactor.toFixed(2),
        activeReport.tariff.toFixed(2),
        h.cost.toFixed(2)
    ]);

    // Summary Total Row
    const totalRow = [
        `"COMBINED TOTALS"`,
        `"3 Residences"`,
        `"${activeReport.period}"`,
        `"--"`,
        `"--"`,
        `"--"`,
        activeReport.totalEnergy.toFixed(5),
        `"--"`,
        `"--"`,
        activeReport.tariff.toFixed(2),
        activeReport.totalCost.toFixed(2)
    ];

    const metadataRows = [
        `"VOLTGUARD IoT - RESIDENTIAL ENERGY MONITORING REPORT"`,
        `"Report ID: ${activeReport.id}"`,
        `"Generated At: ${activeReport.generatedDateDisplay}"`,
        `"Recipients: H1 (${houseEmails[1]}), H2 (${houseEmails[2]}), H3 (${houseEmails[3]})"`,
        `"Disclaimer: Mathematically simulated single-phase load readings (P = V x I x PF)"`,
        `""` // Empty spacer
    ];

    const csvContent = [
        ...metadataRows,
        headers.join(","),
        ...dataRows.map(r => r.join(",")),
        totalRow.join(",")
    ].join("\r\n");

    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const filename = `VoltGuard_Energy_Report_${activeReport.period.replace(/[\s\/]/g, "_")}.csv`;

    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    activeReport.status = "Ready to Send";
    saveReportHistory();
    renderReportHistoryTable();

    showToast("CSV report generated and downloaded successfully.", "success");
}

function downloadPDF() {
    if (!activeReport) {
        activeReport = generateReport(true);
    }

    const element = document.getElementById("reportPreviewDocument");
    if (!element) {
        showToast("Report preview element not found.", "error");
        return;
    }

    const isSingle = currentPreviewScope !== "combined";
    const filename = isSingle
        ? `VoltGuard_Statement_House_${currentPreviewScope}_${activeReport.period.replace(/[\s\/]/g, "_")}.pdf`
        : `VoltGuard_Energy_Report_${activeReport.period.replace(/[\s\/]/g, "_")}.pdf`;

    showToast(`Preparing PDF document (${isSingle ? 'House ' + currentPreviewScope : 'All 3 Houses'})...`, "info");

    const opt = {
        margin: [10, 10, 10, 10],
        filename: filename,
        image: { type: "jpeg", quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, logging: false },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" }
    };

    if (typeof html2pdf !== "undefined") {
        html2pdf().set(opt).from(element).save().then(() => {
            showToast("PDF report downloaded successfully.", "success");
            activeReport.status = "Ready to Send";
            saveReportHistory();
            renderReportHistoryTable();
        }).catch(err => {
            console.error("html2pdf generation error:", err);
            showToast("PDF renderer encountered an issue. Falling back to print dialog.", "warning");
            window.print();
        });
    } else {
        window.print();
    }
}

// =====================================================
// 8. EMAIL DELIVERY WORKFLOW & SECURITY (SEPARATE & COMBINED)
// =====================================================

function validateEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// SEND SEPARATE EMAILS TO ALL 3 HOUSES
async function sendSeparateEmailsToAllHouses() {
    saveHouseEmails();
    const sendBtn = document.getElementById("btnSendReportEmail");

    // Validate emails for all 3 houses
    for (let id = 1; id <= 3; id++) {
        const em = houseEmails[id];
        if (!em || !validateEmail(em)) {
            showFeedbackBox(`Please enter a valid recipient email for House ${id}. Current: "${em || ''}"`, "error");
            const input = document.getElementById(`reportHouse${id}Email`);
            if (input) {
                input.focus();
                input.style.borderColor = "var(--red)";
            }
            showToast(`Invalid email address for House ${id}.`, "error");
            return;
        }
    }

    // Clear border highlights
    [1, 2, 3].forEach(id => {
        const input = document.getElementById(`reportHouse${id}Email`);
        if (input) input.style.borderColor = "";
    });

    if (!activeReport) activeReport = generateReport(true);

    if (sendBtn) {
        sendBtn.disabled = true;
        sendBtn.textContent = "⏳ Sending 3 Separate Emails...";
    }

    showFeedbackBox(`Initiating 3 separate email dispatches: House 1 (${houseEmails[1]}), House 2 (${houseEmails[2]}), House 3 (${houseEmails[3]})...`, "info");

    const separateReports = [1, 2, 3].map(hId => buildHouseReportData(hId, activeReport));
    const batchPayload = {
        period: activeReport.period,
        tariff: activeReport.tariff,
        format: activeReport.format,
        items: separateReports.map(s => ({
            report_id: s.id,
            period: s.period,
            recipient: s.recipientEmail,
            cc: s.ccEmails,
            house_id: s.houseId,
            house_name: s.houseName,
            tariff: s.tariff,
            format: s.format,
            energy: s.totalEnergy,
            cost: s.totalCost,
            voltage: s.telemetry.voltage,
            current: s.telemetry.current,
            power: s.telemetry.power,
            pf: s.telemetry.powerFactor
        }))
    };

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), API_CONFIG.timeoutMs);

        const response = await fetch(API_CONFIG.baseUrl + API_CONFIG.endpoints.sendSeparateEmails, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(batchPayload),
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (response.ok) {
            const data = await response.json();
            separateReports.forEach((s, i) => {
                const dispatchInfo = (data.dispatches && data.dispatches[i]) || {};
                s.status = "Sent";
                s.deliveryLog = `Confirmed by backend SMTP service at ${getCurrentTime()}. Delivery Ref: ${dispatchInfo.delivery_id || "OK-200"}`;
                reportHistory.unshift(s);
            });
            activeReport.status = "Sent (Separate)";
            activeReport.deliveryLog = `3 separate resident bills dispatched to House 1, 2, and 3 via backend service at ${getCurrentTime()}.`;

            showFeedbackBox(`✓ 3 separate electricity reports successfully transmitted to House 1 (${houseEmails[1]}), House 2 (${houseEmails[2]}), and House 3 (${houseEmails[3]})!`, "success");
            showToast("All 3 separate house emails sent successfully!", "success");
        } else {
            throw new Error(`Server returned HTTP ${response.status}`);
        }
    } catch (error) {
        console.warn("Backend batch email dispatch failed or demo mode:", error);
        separateReports.forEach(s => {
            s.status = "Sent (Demo)";
            s.deliveryLog = `Simulated separate SMTP dispatch for ${s.houseName} (${s.recipientEmail}) at ${getCurrentTime()}. Backend offline.`;
            reportHistory.unshift(s);
        });
        activeReport.status = "Sent (Demo)";
        activeReport.deliveryLog = `Simulated 3 separate email dispatches to House 1, 2, and 3. Backend endpoint '${API_CONFIG.endpoints.sendSeparateEmails}' unreachable (${error.message}).`;

        showFeedbackBox(
            `Backend Email Service in Demo Mode. 3 separate resident billing dispatches registered for House 1 (${houseEmails[1]}), House 2 (${houseEmails[2]}), and House 3 (${houseEmails[3]}). Audit logs saved below.`,
            "warning"
        );
        showToast("Demo Mode: 3 separate house emails registered in audit history.", "warning");

        // Offer mailto fallback for House 1 as representative demo
        openHouseMailtoFallback(1, separateReports[0]);
    } finally {
        if (sendBtn) {
            sendBtn.disabled = false;
            sendBtn.textContent = "✉ 5. Send Separate Emails (All 3 Houses)";
        }
        saveReportHistory();
        renderReportHistoryTable();
    }
}

// SEND A BILL TO AN INDIVIDUAL HOUSE RESIDENT
async function sendSingleHouseEmail(houseId) {
    saveHouseEmails();
    const email = houseEmails[houseId];
    const house = houses.find(h => h.id === Number(houseId));
    if (!email || !validateEmail(email)) {
        showFeedbackBox(`Please enter a valid email address for ${house.name}.`, "error");
        document.getElementById(`reportHouse${houseId}Email`)?.focus();
        showToast(`Invalid email for ${house.name}.`, "error");
        return;
    }

    if (!activeReport) activeReport = generateReport(true);
    const single = buildHouseReportData(houseId, activeReport);

    showFeedbackBox(`Initiating email dispatch for ${house.name} to ${email}...`, "info");

    const payload = {
        report_id: single.id,
        period: single.period,
        recipient: email,
        cc: single.ccEmails,
        house_id: house.id,
        house_name: house.name,
        tariff: single.tariff,
        format: single.format,
        energy: single.totalEnergy,
        cost: single.totalCost,
        voltage: single.telemetry.voltage,
        current: single.telemetry.current,
        power: single.telemetry.power,
        pf: single.telemetry.powerFactor
    };

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), API_CONFIG.timeoutMs);

        const response = await fetch(API_CONFIG.baseUrl + API_CONFIG.endpoints.sendEmail, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (response.ok) {
            const data = await response.json();
            single.status = "Sent";
            single.deliveryLog = `Confirmed by backend at ${getCurrentTime()}. Delivery Ref: ${data.delivery_id || "OK-200"}`;
            showFeedbackBox(`Electricity statement for ${house.name} successfully delivered to ${email}!`, "success");
            showToast(`Bill sent to ${house.name} (${email}).`, "success");
        } else {
            throw new Error(`Server returned HTTP ${response.status}`);
        }
    } catch (error) {
        console.warn(`Single house email dispatch error:`, error);
        single.status = "Sent (Demo)";
        single.deliveryLog = `Simulated separate email for ${house.name} to ${email} at ${getCurrentTime()}. Backend offline.`;
        showFeedbackBox(`Backend in Demo Mode. Bill statement for ${house.name} registered for ${email}.`, "warning");
        showToast(`Demo: Bill draft registered for ${house.name}.`, "warning");
        openHouseMailtoFallback(houseId, single);
    } finally {
        reportHistory.unshift(single);
        saveReportHistory();
        renderReportHistoryTable();
    }
}

// SEND COMBINED EXECUTIVE REPORT TO MANAGER
async function sendCombinedManagerReport() {
    saveHouseEmails();
    const mgrEmail = managerEmail || "manager@voltguard.org";
    if (!mgrEmail || !validateEmail(mgrEmail)) {
        showFeedbackBox("Please enter a valid manager email address in the drawer below.", "error");
        document.getElementById("reportRecipientEmail")?.focus();
        showToast("Invalid manager email address.", "error");
        return;
    }

    if (!activeReport) activeReport = generateReport(true);
    activeReport.recipientEmail = mgrEmail;

    showFeedbackBox(`Initiating combined executive report dispatch for manager (${mgrEmail})...`, "info");

    const payload = {
        report_id: activeReport.id,
        period: activeReport.period,
        recipient: mgrEmail,
        cc: activeReport.ccEmails,
        tariff: activeReport.tariff,
        format: activeReport.format,
        energy: activeReport.totalEnergy,
        cost: activeReport.totalCost,
        houses: activeReport.housesData
    };

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), API_CONFIG.timeoutMs);

        const response = await fetch(API_CONFIG.baseUrl + API_CONFIG.endpoints.sendEmail, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (response.ok) {
            const data = await response.json();
            activeReport.status = "Sent";
            activeReport.deliveryLog = `Combined report sent to manager at ${getCurrentTime()}. Delivery Ref: ${data.delivery_id || "OK-200"}`;
            showFeedbackBox(`Combined executive report successfully emailed to manager (${mgrEmail})!`, "success");
            showToast(`Combined report sent to ${mgrEmail}.`, "success");
        } else {
            throw new Error(`Server returned HTTP ${response.status}`);
        }
    } catch (error) {
        console.warn("Combined manager dispatch error:", error);
        activeReport.status = "Sent (Demo)";
        activeReport.deliveryLog = `Simulated manager report dispatch for ${mgrEmail}. Backend endpoint unreachable (${error.message}).`;
        showFeedbackBox(`Backend in Demo Mode. Combined manager report draft recorded for ${mgrEmail}.`, "warning");
        showToast("Demo: Manager report draft registered.", "warning");
        openMailtoFallback(mgrEmail, activeReport);
    } finally {
        saveReportHistory();
        renderReportHistoryTable();
    }
}

// MAILTO FALLBACK FOR A SINGLE HOUSE
function openHouseMailtoFallback(houseId, report) {
    const house = houses.find(h => h.id === Number(houseId)) || houses[0];
    const email = houseEmails[house.id] || "resident@voltguard.org";
    const subject = encodeURIComponent(`VoltGuard IoT Electricity Bill: ${house.name} (${house.type}) — ${report.period} [Ref: ${report.id}]`);
    const bodyLines = [
        `VOLTGUARD IoT — RESIDENTIAL ELECTRICITY STATEMENT`,
        `Residence: ${house.name} (${house.type})`,
        `Statement ID: ${report.id}`,
        `Billing Period: ${report.period}`,
        `Resident Mailbox: ${email}`,
        `Generated: ${report.generatedDateDisplay}`,
        `Tariff Rate: ₹${report.tariff.toFixed(2)} / kWh`,
        ``,
        `INDIVIDUAL CONSUMPTION & CHARGES:`,
        `- Energy Consumed: ${report.totalEnergy} kWh`,
        `- Total Net Amount Due: ₹${report.totalCost}`,
        `- Share of Total Estate Load: ${report.percentageOfEstate || 33.3}%`,
        ``,
        `ELECTRICAL TELEMETRY MEASUREMENTS:`,
        `- Voltage: ${report.telemetry.voltage.toFixed(1)} V`,
        `- Current: ${report.telemetry.current.toFixed(2)} A`,
        `- Active Power: ${report.telemetry.power.toFixed(0)} W`,
        `- Grid Frequency: ${report.telemetry.frequency.toFixed(1)} Hz`,
        `- Power Factor: ${report.telemetry.powerFactor.toFixed(2)}`,
        ``,
        `Note: Figures computed via single-phase telemetry model.`,
        `Generated by VoltGuard IoT Monitoring System.`
    ];

    const body = encodeURIComponent(bodyLines.join("\n"));
    const mailtoUrl = `mailto:${encodeURIComponent(email)}?subject=${subject}&body=${body}`;

    setTimeout(() => {
        if (confirm(`Backend email server is currently in demo mode. Would you like to open your email client with the pre-filled bill statement for ${house.name} (${email})?`)) {
            window.location.href = mailtoUrl;
        }
    }, 600);
}

function openMailtoFallback(email, report) {
    const subject = encodeURIComponent(`VoltGuard IoT Energy Report — ${report.period} [Ref: ${report.id}]`);
    const bodyLines = [
        `VOLTGUARD IoT — RESIDENTIAL ENERGY REPORT`,
        `Report ID: ${report.id}`,
        `Reporting Period: ${report.period}`,
        `Generated: ${report.generatedDateDisplay}`,
        `Tariff: ₹${report.tariff.toFixed(2)} / kWh`,
        `Note: Electrical measurements generated by single-phase simulation model.`,
        ``,
        `SUMMARY ACROSS 3 RESIDENCES:`,
        `Combined Energy: ${report.totalEnergy} kWh`,
        `Combined Estimated Bill: ₹${report.totalCost}`,
        `Highest Consumer: ${report.highestConsumer ? report.highestConsumer.name : 'House 1'}`,
        `Lowest Consumer: ${report.lowestConsumer ? report.lowestConsumer.name : 'House 3'}`,
        ``,
        `HOUSE BREAKDOWN:`,
        ...(report.housesData || []).map(h => `- ${h.name} (${h.type}): ${h.energy} kWh | ₹${h.cost} (${h.percentage}% of total)`),
        ``,
        `Generated by VoltGuard IoT Monitoring System.`
    ];

    const body = encodeURIComponent(bodyLines.join("\n"));
    const mailtoUrl = `mailto:${encodeURIComponent(email)}?subject=${subject}&body=${body}`;

    setTimeout(() => {
        if (confirm("Backend email server is currently in demo mode. Would you like to open your default email app to review and send this report draft?")) {
            window.location.href = mailtoUrl;
        }
    }, 600);
}

function showFeedbackBox(message, type = "info") {
    const box = document.getElementById("actionFeedbackBox");
    const textEl = document.getElementById("feedbackText");
    const iconEl = document.getElementById("feedbackIcon");
    if (!box || !textEl) return;

    box.className = `action-feedback-box ${type}`;
    textEl.textContent = message;

    if (iconEl) {
        if (type === "success") iconEl.textContent = "✓";
        else if (type === "error") iconEl.textContent = "⚠";
        else if (type === "warning") iconEl.textContent = "⚡";
        else iconEl.textContent = "ℹ";
    }

    box.hidden = false;
}

// =====================================================
// 9. PANEL D: REPORT HISTORY MANAGEMENT
// =====================================================

async function loadReportHistory() {
    try {
        const stored = localStorage.getItem("voltguard_report_history");
        if (stored) {
            reportHistory = JSON.parse(stored);
        } else {
            // Seed with one illustrative historical report record
            reportHistory = [
                {
                    id: "VG-RPT-202609-102",
                    period: "September 2026",
                    generatedAt: new Date(Date.now() - 86400000 * 12).toISOString(),
                    generatedDateDisplay: "September 30, 2026 at 11:59 PM",
                    totalEnergy: 625.776,
                    totalCost: 5319.10,
                    recipientEmail: "resident.manager@voltguard.org",
                    status: "Sent",
                    tariff: 8.50,
                    highestConsumer: houses[0],
                    lowestConsumer: houses[2],
                    housesData: houses.map(h => ({
                        id: h.id,
                        name: h.name,
                        type: h.type,
                        voltage: 231.0,
                        current: h.current,
                        power: h.power,
                        energy: h.energy,
                        frequency: 50.0,
                        powerFactor: h.powerFactor,
                        cost: calculateCost(h.energy),
                        percentage: 33.3
                    })),
                    deliveryLog: "Delivered via SMTP Gateway to resident.manager@voltguard.org"
                }
            ];
            saveReportHistory();
        }
    } catch (e) {
        console.error("Error reading report history:", e);
        reportHistory = [];
    }

    // If backend connected, sync with database audit logs
    if (backendConnected) {
        try {
            const res = await fetch(API_CONFIG.baseUrl + API_CONFIG.endpoints.emailLogs);
            if (res.ok) {
                const json = await res.json();
                if (json.data && json.data.length > 0) {
                    const dbReports = json.data.map(r => ({
                        id: r.report_id,
                        period: r.period,
                        generatedAt: r.timestamp,
                        generatedDateDisplay: r.timestamp.replace("T", " ").split(".")[0],
                        totalEnergy: r.energy,
                        totalCost: r.cost,
                        recipientEmail: r.recipient,
                        status: r.status,
                        tariff: r.tariff,
                        deliveryLog: `Persisted in SQLite database [Delivery Ref: ${r.delivery_id}]`,
                        format: r.format
                    }));
                    reportHistory = dbReports;
                    saveReportHistory();
                }
            }
        } catch (e) {
            console.warn("Could not sync email logs from DB:", e);
        }
    }

    renderReportHistoryTable();
}

function saveReportHistory() {
    try {
        localStorage.setItem("voltguard_report_history", JSON.stringify(reportHistory));
    } catch (e) {
        console.error("Error storing report history:", e);
    }
}

function renderReportHistoryTable() {
    const tbody = document.getElementById("historyTableBody");
    if (!tbody) return;

    if (reportHistory.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--text-muted); padding:20px;">No energy reports generated yet. Click "Generate Report" above.</td></tr>`;
        return;
    }

    tbody.innerHTML = reportHistory.map((rpt, idx) => {
        let statusClass = "draft";
        const st = rpt.status ? rpt.status.toLowerCase() : "draft";
        if (st.includes("sent")) statusClass = "sent";
        else if (st.includes("fail")) statusClass = "failed";
        else if (st.includes("ready")) statusClass = "ready";
        else if (st.includes("sending")) statusClass = "sending";
        else if (st.includes("sched")) statusClass = "scheduled";

        return `
            <tr>
                <td><strong>${rpt.id}</strong></td>
                <td>${rpt.period}</td>
                <td><small>${rpt.generatedDateDisplay.split(" at")[0]}</small></td>
                <td><strong>${formatNumber(rpt.totalEnergy, 2)} kWh</strong></td>
                <td><strong>₹${formatNumber(rpt.totalCost, 2)}</strong></td>
                <td><small>${rpt.recipientEmail}</small></td>
                <td><span class="status-pill ${statusClass}">${rpt.status || "Draft"}</span></td>
                <td>
                    <div class="history-action-btns">
                        <button type="button" class="action-icon-btn btn-hist-preview" data-idx="${idx}" title="Preview Report">👁</button>
                        <button type="button" class="action-icon-btn btn-hist-download" data-idx="${idx}" title="Download CSV">📥</button>
                        <button type="button" class="action-icon-btn btn-hist-status" data-idx="${idx}" title="View Delivery Log">ℹ</button>
                    </div>
                </td>
            </tr>
        `;
    }).join("");

    // Bind action buttons
    tbody.querySelectorAll(".btn-hist-preview").forEach(btn => {
        btn.addEventListener("click", () => {
            const idx = Number(btn.dataset.idx);
            activeReport = reportHistory[idx];
            updatePanelBSummary(activeReport);
            updatePanelCPreview(activeReport);
            document.getElementById("panelReportPreview")?.scrollIntoView({ behavior: "smooth" });
            showToast(`Loaded preview for report ${activeReport.id}.`, "info");
        });
    });

    tbody.querySelectorAll(".btn-hist-download").forEach(btn => {
        btn.addEventListener("click", () => {
            const idx = Number(btn.dataset.idx);
            activeReport = reportHistory[idx];
            downloadCSV();
        });
    });

    tbody.querySelectorAll(".btn-hist-status").forEach(btn => {
        btn.addEventListener("click", () => {
            const idx = Number(btn.dataset.idx);
            openDeliveryStatusModal(reportHistory[idx]);
        });
    });
}

function openDeliveryStatusModal(report) {
    const modal = document.getElementById("deliveryStatusModal");
    const titleEl = document.getElementById("modalTitle");
    const bodyEl = document.getElementById("modalBody");
    if (!modal || !bodyEl) return;

    if (titleEl) titleEl.textContent = `Report Audit: ${report.id}`;

    bodyEl.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:12px;">
            <div><strong>Reporting Period:</strong> <span>${report.period}</span></div>
            <div><strong>Generation Timestamp:</strong> <span>${report.generatedDateDisplay}</span></div>
            <div><strong>Recipient:</strong> <span>${report.recipientEmail}</span></div>
            <div><strong>Current Delivery Status:</strong> <span class="status-pill ${report.status ? report.status.toLowerCase() : 'draft'}">${report.status || "Draft"}</span></div>
            <div style="padding:12px; background:var(--surface-light); border:1px solid var(--border); border-radius:8px;">
                <strong>Audit &amp; Dispatch Log:</strong>
                <p style="margin-top:6px; color:var(--text-secondary); font-size:12px;">${report.deliveryLog || "No external delivery attempt registered."}</p>
            </div>
            <p style="font-size:11px; color:var(--text-muted);">
                Security Note: Actual delivery requires confirmed acknowledgment from the configured backend email service. VoltGuard never fabricates successful SMTP transmissions.
            </p>
        </div>
    `;

    modal.hidden = false;
}

// =====================================================
// 10. AUTOMATIC MONTHLY EMAIL SCHEDULING (SECTION 5)
// =====================================================

function calculateNextDeliveryDate(deliveryDay, deliveryTime) {
    const now = new Date();
    let targetYear = now.getFullYear();
    let targetMonth = now.getMonth();

    const [hours, minutes] = (deliveryTime || "09:00").split(":").map(Number);

    let dayNumber = deliveryDay === "last" ? new Date(targetYear, targetMonth + 1, 0).getDate() : parseInt(deliveryDay, 10);

    let targetDate = new Date(targetYear, targetMonth, dayNumber, hours, minutes, 0);

    // If target has already passed in the current month, schedule for next month
    if (targetDate <= now) {
        targetMonth += 1;
        if (targetMonth > 11) {
            targetMonth = 0;
            targetYear += 1;
        }
        dayNumber = deliveryDay === "last" ? new Date(targetYear, targetMonth + 1, 0).getDate() : parseInt(deliveryDay, 10);
        targetDate = new Date(targetYear, targetMonth, dayNumber, hours, minutes, 0);
    }

    return targetDate.toLocaleString("en-IN", {
        month: "long",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true
    });
}

function updateSchedulerNextRunDisplay() {
    const day = document.getElementById("schedDeliveryDay")?.value || "1";
    const time = document.getElementById("schedDeliveryTime")?.value || "09:00";
    const displayEl = document.getElementById("schedNextRunDisplay");

    if (displayEl) {
        const nextDateStr = calculateNextDeliveryDate(day, time);
        displayEl.textContent = `${nextDateStr} (Demo Schedule)`;
    }
}

async function loadSchedulerConfig() {
    try {
        const stored = localStorage.getItem("voltguard_scheduler_config");
        if (stored) {
            schedulerConfig = { ...schedulerConfig, ...JSON.parse(stored) };
        }
    } catch (e) {
        console.error("Error reading scheduler config:", e);
    }

    if (backendConnected) {
        try {
            const res = await fetch(API_CONFIG.baseUrl + API_CONFIG.endpoints.schedule);
            if (res.ok) {
                const dbConfig = await res.json();
                schedulerConfig.enabled = Boolean(dbConfig.enabled);
                schedulerConfig.deliveryMode = dbConfig.delivery_mode || "separate";
                schedulerConfig.recipientEmail = dbConfig.recipient_email || "manager@voltguard.org";
                schedulerConfig.deliveryDay = dbConfig.delivery_day || "1";
                schedulerConfig.deliveryTime = dbConfig.delivery_time || "09:00";
                schedulerConfig.reportingPeriod = dbConfig.reporting_period || "prev_calendar_month";
                schedulerConfig.format = dbConfig.format || "pdf";
                schedulerConfig.timezone = dbConfig.timezone || "Asia/Kolkata";
            }
        } catch (e) {
            console.warn("Could not sync schedule from backend:", e);
        }
    }

    const toggle = document.getElementById("schedulerEnableToggle");
    const mode = document.getElementById("schedDeliveryMode");
    const email = document.getElementById("schedRecipientEmail");
    const day = document.getElementById("schedDeliveryDay");
    const time = document.getElementById("schedDeliveryTime");
    const period = document.getElementById("schedReportingPeriod");
    const format = document.getElementById("schedFormat");
    const tz = document.getElementById("schedTimezone");

    if (toggle) toggle.checked = schedulerConfig.enabled;
    if (mode) mode.value = schedulerConfig.deliveryMode || "separate";
    if (email) email.value = schedulerConfig.recipientEmail;
    if (day) day.value = schedulerConfig.deliveryDay;
    if (time) time.value = schedulerConfig.deliveryTime;
    if (period) period.value = schedulerConfig.reportingPeriod;
    if (format) format.value = schedulerConfig.format;
    if (tz) tz.value = schedulerConfig.timezone;

    updateSchedulerNextRunDisplay();
    updateSchedulerStatusBadge();
    updateSchedulerRecipientTags();
}

async function saveSchedulerConfig() {
    const toggle = document.getElementById("schedulerEnableToggle");
    const mode = document.getElementById("schedDeliveryMode");
    const email = document.getElementById("schedRecipientEmail");
    const day = document.getElementById("schedDeliveryDay");
    const time = document.getElementById("schedDeliveryTime");
    const period = document.getElementById("schedReportingPeriod");
    const format = document.getElementById("schedFormat");
    const tz = document.getElementById("schedTimezone");

    schedulerConfig = {
        enabled: toggle ? toggle.checked : true,
        deliveryMode: mode ? mode.value : "separate",
        recipientEmail: email ? email.value.trim() : "manager@voltguard.org",
        deliveryDay: day ? day.value : "1",
        deliveryTime: time ? time.value : "09:00",
        reportingPeriod: period ? period.value : "prev_calendar_month",
        format: format ? format.value : "pdf",
        timezone: tz ? tz.value : "Asia/Kolkata"
    };

    try {
        localStorage.setItem("voltguard_scheduler_config", JSON.stringify(schedulerConfig));
    } catch (e) {
        console.error("Error saving scheduler config:", e);
    }

    // Save to backend database if connected
    if (backendConnected) {
        try {
            await fetch(API_CONFIG.baseUrl + API_CONFIG.endpoints.schedule, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(schedulerConfig)
            });
        } catch (e) {
            console.warn("Failed to persist schedule to backend database:", e);
        }
    }

    updateSchedulerNextRunDisplay();
    updateSchedulerStatusBadge();
    updateSchedulerRecipientTags();

    const feedback = document.getElementById("schedulerFeedback");
    if (feedback) {
        feedback.hidden = false;
        const modeDesc = schedulerConfig.deliveryMode === 'separate' ? 'Separate 3-House Resident Bills' :
                         schedulerConfig.deliveryMode === 'both' ? 'Separate Bills + Manager Copy' : 'Combined Manager Overview';
        const syncNote = backendConnected ? ' &amp; Persisted to SQLite DB' : ' (Local)';
        feedback.innerHTML = `✓ Schedule saved${syncNote}. <strong>Mode:</strong> ${modeDesc}. Next trigger: <strong>${calculateNextDeliveryDate(schedulerConfig.deliveryDay, schedulerConfig.deliveryTime)}</strong>.`;
        feedback.style.color = "var(--green)";
    }

    showToast(backendConnected ? "Schedule saved to database." : "Schedule saved locally.", "success");
}

function updateSchedulerStatusBadge() {
    const badge = document.getElementById("schedulerStatusBadge");
    const dot = document.getElementById("schedulerDot");
    const text = document.getElementById("schedulerStatusText");

    if (!badge || !text) return;

    if (schedulerConfig.enabled) {
        if (dot) dot.style.background = "var(--purple)";
        text.textContent = "Simulated Monthly Schedule (Active)";
    } else {
        if (dot) dot.style.background = "var(--text-muted)";
        text.textContent = "Monthly Schedule Disabled";
    }
}

function simulateScheduleDispatch() {
    if (!schedulerConfig.enabled) {
        showToast("Scheduler is currently disabled. Enable it to simulate trigger.", "warning");
        return;
    }

    const mode = schedulerConfig.deliveryMode || "separate";
    showToast(`Simulating monthly scheduled report dispatch (${mode === 'separate' ? '3 Separate Bills' : mode})...`, "info");

    const baseReport = buildReportData();
    const timestampStr = getCurrentTime();

    if (mode === "separate" || mode === "both") {
        // Dispatch 3 separate reports for House 1, 2, 3
        [1, 2, 3].forEach(hId => {
            const single = buildHouseReportData(hId, baseReport);
            single.id = `VG-SCHED-H${hId}-${Date.now().toString().slice(-5)}`;
            single.status = "Scheduled";
            single.deliveryLog = `Automated scheduled cron dispatch executed at ${timestampStr} for ${single.houseName} (${single.recipientEmail}).`;
            reportHistory.unshift(single);
        });
    }

    if (mode === "manager" || mode === "both") {
        const simReport = { ...baseReport };
        simReport.id = `VG-SCHED-MGR-${Date.now().toString().slice(-5)}`;
        simReport.recipientEmail = schedulerConfig.recipientEmail || managerEmail;
        simReport.status = "Scheduled";
        simReport.deliveryLog = `Automated scheduled cron dispatch executed at ${timestampStr} for facility manager (${simReport.recipientEmail}).`;
        reportHistory.unshift(simReport);
    }

    saveReportHistory();
    renderReportHistoryTable();

    setTimeout(() => {
        showToast(`Scheduled monthly dispatch completed. Separate reports registered in audit history.`, "success");
    }, 500);
}

// =====================================================
// 11. BACKEND CONNECTIVITY CHECK
// =====================================================

async function checkBackendConnectivity() {
    const badge = document.getElementById("backendStatusBadge");
    const label = document.getElementById("backendStatusLabel");
    const dot = document.getElementById("topbarStatusDot");
    const sideDot = document.getElementById("sidebarStatusDot");
    const sideText = document.getElementById("sidebarStatusText");
    const sideDetail = document.getElementById("sidebarStatusDetail");

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);

        const response = await fetch(API_CONFIG.baseUrl + API_CONFIG.endpoints.health, {
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (response.ok) {
            const wasConnected = backendConnected;
            backendConnected = true;
            if (badge) badge.className = "badge backend-status-badge connected";
            if (label) label.textContent = "BACKEND ONLINE (Port 8000 · DB Synced)";
            if (dot) dot.className = "status-indicator-dot connected";
            if (sideDot) sideDot.className = "status-indicator-dot connected";
            if (sideText) sideText.textContent = "Backend Connected";
            if (sideDetail) sideDetail.textContent = "FastAPI / SQLite Live Sync";

            if (!wasConnected) {
                // Initial connection or reconnect: pull latest database state
                await fetchBackendInitialState();
                await loadReportHistory();
                await loadSchedulerConfig();
            }
        } else {
            throw new Error("Backend returned error");
        }
    } catch (e) {
        backendConnected = false;
        if (badge) badge.className = "badge backend-status-badge";
        if (label) label.textContent = "DEMO SIMULATION ACTIVE";
        if (dot) dot.className = "status-indicator-dot";
        if (sideDot) sideDot.className = "status-indicator-dot";
        if (sideText) sideText.textContent = "Demo Mode (Simulation)";
        if (sideDetail) sideDetail.textContent = "Stand-alone single-phase model";
    }
}

// =====================================================
// 12. TOAST NOTIFICATION SYSTEM
// =====================================================

function showToast(message, type = "info") {
    const container = document.getElementById("toastContainer");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.setAttribute("role", "status");

    let icon = "ℹ";
    if (type === "success") icon = "✓";
    else if (type === "error") icon = "⚠";
    else if (type === "warning") icon = "⚡";

    toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translateY(15px)";
        toast.style.transition = "all 0.3s ease";
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// =====================================================
// 13. EVENT LISTENERS & INITIALIZATION
// =====================================================

function initializeEventListeners() {
    // Report action buttons
    document.getElementById("btnGenerateReport")?.addEventListener("click", () => generateReport(false));
    document.getElementById("btnPreviewReport")?.addEventListener("click", () => {
        generateReport(true);
        document.getElementById("panelReportPreview")?.scrollIntoView({ behavior: "smooth" });
        showToast("Scrolled to formatted report preview.", "info");
    });
    document.getElementById("btnDownloadPdf")?.addEventListener("click", downloadPDF);
    document.getElementById("btnDownloadCsv")?.addEventListener("click", downloadCSV);
    document.getElementById("btnSendReportEmail")?.addEventListener("click", sendSeparateEmailsToAllHouses);
    document.getElementById("btnSendCombinedReport")?.addEventListener("click", sendCombinedManagerReport);
    document.getElementById("btnJumpToScheduler")?.addEventListener("click", () => {
        document.getElementById("scheduling")?.scrollIntoView({ behavior: "smooth" });
        document.getElementById("schedRecipientEmail")?.focus();
    });

    // Individual quick-send buttons for each house
    document.getElementById("btnSendHouse1")?.addEventListener("click", () => sendSingleHouseEmail(1));
    document.getElementById("btnSendHouse2")?.addEventListener("click", () => sendSingleHouseEmail(2));
    document.getElementById("btnSendHouse3")?.addEventListener("click", () => sendSingleHouseEmail(3));

    // House email inputs live save and update scheduler
    ["reportHouse1Email", "reportHouse2Email", "reportHouse3Email", "reportRecipientEmail"].forEach(id => {
        document.getElementById(id)?.addEventListener("input", () => {
            saveHouseEmails();
            updateSchedulerRecipientTags();
        });
    });

    // Preview Scope selector tabs (Combined vs House 1 vs House 2 vs House 3)
    document.querySelectorAll(".scope-tab").forEach(tab => {
        tab.addEventListener("click", () => {
            document.querySelectorAll(".scope-tab").forEach(t => t.classList.remove("active"));
            tab.classList.add("active");
            currentPreviewScope = tab.dataset.scope || "combined";
            if (!activeReport) activeReport = generateReport(true);
            updatePanelCPreview(activeReport);
            showToast(`Switched preview: ${tab.textContent.trim().replace(/^[^\w]+/, '')}`, "info");
        });
    });

    // Delivery mode change handler
    document.getElementById("schedDeliveryMode")?.addEventListener("change", (e) => {
        schedulerConfig.deliveryMode = e.target.value;
        updateSchedulerRecipientTags();
    });

    // Preview tools
    document.getElementById("btnPrintPreview")?.addEventListener("click", () => window.print());
    document.getElementById("btnCopyReportText")?.addEventListener("click", () => {
        if (!activeReport) activeReport = generateReport(true);
        const text = `VOLTGUARD IoT Energy Report (${activeReport.period})\nTotal: ${activeReport.totalEnergy} kWh (₹${activeReport.totalCost})\nHouse 1: ${activeReport.housesData[0].energy} kWh\nHouse 2: ${activeReport.housesData[1].energy} kWh\nHouse 3: ${activeReport.housesData[2].energy} kWh`;
        navigator.clipboard.writeText(text).then(() => {
            showToast("Report summary copied to clipboard.", "success");
        }).catch(() => {
            showToast("Clipboard copy permission denied.", "warning");
        });
    });

    // Clear history button
    document.getElementById("btnClearHistory")?.addEventListener("click", async () => {
        if (confirm("Are you sure you want to clear your report history and audit records?")) {
            reportHistory = [];
            saveReportHistory();
            renderReportHistoryTable();

            if (backendConnected) {
                try {
                    await fetch(API_CONFIG.baseUrl + API_CONFIG.endpoints.emailLogs, { method: "DELETE" });
                } catch (e) {
                    console.warn("Failed to clear backend email logs:", e);
                }
            }
            showToast("Report history and audit logs cleared.", "info");
        }
    });

    // Scheduler actions
    document.getElementById("btnSaveSchedule")?.addEventListener("click", saveSchedulerConfig);
    document.getElementById("btnTestScheduleTrigger")?.addEventListener("click", simulateScheduleDispatch);
    document.getElementById("btnResetSchedule")?.addEventListener("click", () => {
        document.getElementById("schedulerEnableToggle").checked = true;
        document.getElementById("schedRecipientEmail").value = "manager@voltguard.org";
        document.getElementById("schedDeliveryDay").value = "1";
        document.getElementById("schedDeliveryTime").value = "09:00";
        document.getElementById("schedReportingPeriod").value = "prev_calendar_month";
        document.getElementById("schedFormat").value = "pdf";
        document.getElementById("schedTimezone").value = "Asia/Kolkata";
        saveSchedulerConfig();
        showToast("Scheduler reset to defaults.", "info");
    });

    // Scheduler inputs change listener
    ["schedDeliveryDay", "schedDeliveryTime"].forEach(id => {
        document.getElementById(id)?.addEventListener("change", updateSchedulerNextRunDisplay);
    });

    // House report buttons (linking directly to reports section with house context)
    document.querySelectorAll(".house-report-button").forEach(btn => {
        btn.addEventListener("click", () => {
            const houseIndex = Number(btn.dataset.house);
            const house = houses[houseIndex];
            generateReport(true);
            document.getElementById("reports")?.scrollIntoView({ behavior: "smooth" });
            showToast(`Generated report with focus on ${house.name} (${house.type}).`, "info");
        });
    });

    // Navigation smooth scrolling & active link highlighting
    document.querySelectorAll(".nav-link").forEach(link => {
        link.addEventListener("click", () => {
            document.querySelectorAll(".nav-link").forEach(l => l.classList.remove("active"));
            link.classList.add("active");
        });
    });

    // Backend status pill click -> manually recheck
    document.getElementById("backendStatusBadge")?.addEventListener("click", () => {
        showToast("Testing connection to FastAPI backend...", "info");
        checkBackendConnectivity();
    });

    // Tariff input live update
    document.getElementById("reportTariffInput")?.addEventListener("input", (e) => {
        const val = parseFloat(e.target.value);
        if (!isNaN(val) && val > 0) {
            CONFIG.tariff = val;
            const badge = document.getElementById("sidebarTariffBadge");
            if (badge) badge.textContent = `₹${val.toFixed(2)} / kWh`;
            updateHouseCards();
            updateHouseComparison();
        }
    });

    // Modal close events
    document.getElementById("btnCloseStatusModal")?.addEventListener("click", () => {
        const modal = document.getElementById("deliveryStatusModal");
        if (modal) modal.hidden = true;
    });
    document.getElementById("btnModalClose")?.addEventListener("click", () => {
        const modal = document.getElementById("deliveryStatusModal");
        if (modal) modal.hidden = true;
    });
    document.getElementById("deliveryStatusModal")?.addEventListener("click", (e) => {
        if (e.target.id === "deliveryStatusModal") {
            e.target.hidden = true;
        }
    });
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            const modal = document.getElementById("deliveryStatusModal");
            if (modal && !modal.hidden) {
                modal.hidden = true;
            }
        }
    });
}

function initializeApplication() {
    // Pre-populate initial telemetry history
    houses.forEach(h => {
        h.history.push({
            time: getCurrentTime(),
            power: h.power,
            voltage: h.voltage,
            current: h.current,
            energy: h.energy,
            pf: h.powerFactor,
            frequency: h.frequency
        });
    });

    initializePowerChart();
    initializeEnergyChart();
    initializePeriodFilters();
    loadHouseEmails();
    loadReportHistory();
    renderReportHistoryTable();
    loadSchedulerConfig();
    initializeEventListeners();

    // Generate initial default report for preview
    generateReport(true);

    // Initial dashboard telemetry render & start simulation loop
    updateDashboard();
    startSimulation();

    // Check backend health asynchronously
    checkBackendConnectivity();
    setInterval(checkBackendConnectivity, 15000); // Check every 15s

    console.log("VoltGuard IoT: Multi-house dashboard initialized successfully.");
}

document.addEventListener("DOMContentLoaded", initializeApplication);

