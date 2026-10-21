# ⚡ Smart IoT Energy Meter

### An IoT-Based Real-Time Energy Monitoring and Management System

## 📌 Project Overview

The **Smart IoT Energy Meter** is an IoT-based energy monitoring system designed to measure and monitor electrical parameters in real time.

The system uses an **ESP32 microcontroller** and **PZEM-004T energy monitoring modules** to measure voltage, current, power, and energy consumption. The measured values are displayed on an OLED screen and transmitted through Wi-Fi to a web-based dashboard for remote monitoring.

The proposed system supports independent energy monitoring for multiple houses, helping users understand electricity consumption and improve energy management.

## 🎯 Objectives

- Monitor electrical parameters in real time.
- Measure voltage, current, power, and energy consumption.
- Display measurements on an OLED display.
- Transmit energy data wirelessly using the ESP32's built-in Wi-Fi.
- Visualize energy consumption through a web dashboard.
- Support separate monitoring of multiple houses.
- Promote efficient electricity usage and energy awareness.

## 🛠️ Hardware Components

| S.No. | Component | Purpose |
|:---:|---|---|
| 1 | ESP32 Development Board | Processes measurement data and provides Wi-Fi connectivity. |
| 2 | PZEM-004T Energy Meter Module | Measures electrical parameters. |
| 3 | OLED Display (SSD1306) | Displays electrical measurements locally. |
| 4 | AC-to-DC Power Adapter | Supplies power to the electronic system. |
| 5 | Connecting Wires | Establish electrical and communication connections. |
| 6 | Enclosure | Protects and houses the electronic components. |
| 7 | Cable Glands | Provide cable entry and strain relief. |

## 💻 Software and Technologies

| Technology | Application |
|---|---|
| MicroPython | Programming the ESP32 |
| ESP32 | Embedded processing and wireless communication |
| UART | Communication between the ESP32 and PZEM-004T |
| I2C | Communication between the ESP32 and OLED display |
| Wi-Fi | Wireless data transmission |
| SSD1306 Library | OLED display control |
| Wokwi | Circuit simulation and testing |
| Web Dashboard | Remote energy monitoring and visualization |
| Fusion 360 | 3D enclosure design |

## ⚙️ System Architecture

The system follows the workflow below:

1. **Energy Measurement:** The PZEM-004T measures electrical parameters from the connected load.
2. **Data Acquisition:** The ESP32 receives the measured values through UART communication.
3. **Local Monitoring:** The OLED display presents the electrical measurements.
4. **Wireless Transmission:** The ESP32 transmits the collected data through Wi-Fi.
5. **Dashboard Visualization:** The web dashboard displays the received energy readings.
6. **Energy Analysis:** Users can monitor consumption and make informed decisions about electricity usage.

### System Block Diagram

```text
       AC Electrical Supply
                |
                v
       Connected Electrical Load
                |
                v
        PZEM-004T Energy Meter
                |
              UART
                |
                v
            ESP32 Board
             /       \
            /         \
          I2C         Wi-Fi
           |             |
           v             v
      OLED Display   Web Dashboard
           |             |
           v             v
     Local Monitoring  Remote Monitoring