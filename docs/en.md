# Viessmann ViCare

This integration connects Viessmann boilers (gas, oil) and heat pumps linked
to the **ViCare** app to Gladys, through the Viessmann cloud: heating, domestic
hot water, temperatures and consumption.

## Requirements

- A Viessmann appliance visible in the ViCare app (Vitoconnect gateway or
  built-in gateway).
- Your ViCare account (e-mail address and password).
- Gladys 5.1 or later, with Internet access.

## 1. Create a client on the Viessmann developer portal

The ViCare API needs a free, personal "client", created once:

1. Open the [Viessmann developer portal](https://app.developer.viessmann-climatesolutions.com)
   and sign in with your ViCare credentials.
2. Create a new client (**Clients** menu).
3. Give it a name (for example "Gladys") and set its **redirect URI** to the
   address shown in the Configuration screen of the integration, under the
   **Connect** button: `https://my.gladysassistant.com/redirect/oauth`. It must
   match character for character. Leave the other options to their defaults.
4. Save, then copy the **Client ID**. No secret is needed.

The free plan ("Basic") is enough: it allows 1450 API calls a day.

## 2. Configure the integration in Gladys

The order matters: Gladys needs the saved client ID to start the connection.

1. In the **Configuration** tab of the integration (step 1 of the screen),
   paste the client ID.
2. Click **Save configuration**, at the bottom of the page. The message at the
   top of the screen then starts with "Client ID saved".
3. Only then, in step 2 (**ViCare account**), click **Connect**, sign in with
   your ViCare account and accept the access.
4. The status turns to "Connected". The **Test the connection** button lists
   the installations, gateways and appliances found.
5. In the **Discovery** tab, add the devices and put each heating circuit in
   its room.

## Devices

For each boiler or heat pump, the integration offers up to three kinds of
devices. Only the features your model actually reports are created.

### One thermostat per heating circuit

| Feature            | Description                                                                                                                             |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Target temperature | Temperature of the program currently running (normal, reduced, comfort...). Changing it changes that program, like the ViCare app does. |
| Mode               | Off, heating, cooling or auto (see the table below).                                                                                    |
| Operating state    | Idle, heating or cooling, from the burner or compressor.                                                                                |
| Room temperature   | When a room sensor is wired to the circuit.                                                                                             |
| Supply temperature | Temperature of the water sent into the circuit.                                                                                         |

### Domestic hot water (water heater)

| Feature                      | Description                                                     |
| ---------------------------- | --------------------------------------------------------------- |
| Hot water target temperature | Requested hot water temperature.                                |
| Hot water mode               | On recent (E3) appliances and heat pumps (see the table below). |
| One-time charge              | Heat the tank once, right now.                                  |
| Hot water heating            | The tank is being heated.                                       |
| Hot water tank temperature   | Temperature measured in the tank.                               |

### Heat generator (boiler or heat pump)

Read-only sensors: outside, boiler, supply and return temperatures (primary
and secondary circuits on heat pumps), burner and compressor (running, number
of starts, operating hours), today's gas consumption (m³ or kWh depending on
the model) and power consumption (kWh).

### Mode mapping

Heating circuit mode:

| ViCare mode                                                 | Gladys mode |
| ----------------------------------------------------------- | ----------- |
| `standby`, `dhw` (hot water only)                           | Off         |
| `heating`, `dhwAndHeating`, `forcedNormal`, `forcedReduced` | Heating     |
| `cooling`                                                   | Cooling     |
| `heatingCooling`, `dhwAndHeatingCooling`                    | Auto        |

Turning a circuit **off** from Gladys picks `dhw` when the appliance supports
it: heating stops but hot water keeps being produced. Hot water has its own
controls, on the water heater device.

Hot water mode:

| ViCare mode                                   | Gladys mode |
| --------------------------------------------- | ----------- |
| `off`                                         | Off         |
| `eco`, `efficient`, `efficientWithMinComfort` | Eco         |
| `balanced`                                    | Auto        |
| `comfort`                                     | Manual      |

A mode your appliance does not offer is refused, with a message listing the
accepted modes.

## Refresh and quota

- The integration reads every value of a gateway in **a single call**. The
  default interval (120 s) uses about 720 of the 1450 daily calls. With
  several gateways, the interval is multiplied by their number to stay within
  the quota.
- After a command, the new value shows up right away, and the appliance is
  read again about fifteen seconds later to confirm it.
- When the quota is exhausted, the integration pauses until it renews. The
  Configuration screen shows when it resumes (UTC). Raise the refresh interval
  if it happens.

## Known limitations

- **Presets** (comfort, eco, away) are not offered yet: Gladys 5.1 has no
  thermostat preset feature.
- When the circuit runs a program without an adjustable temperature (standby,
  frost protection), the target temperature is not shown and cannot be
  changed.
- Not supported yet: burner modulation (Gladys has no matching category),
  solar thermal, photovoltaics and batteries, ventilation, Zigbee thermostats
  and sensors, the heating curve and the temperature of each program.
- Control only goes through the Viessmann cloud: an Internet connection is
  required.

## Troubleshooting

- **"Enter the client ID…"**: paste the Client ID of the developer portal and
  click **Save configuration** before clicking Connect.
- **"There was an error starting the connection"** under the Connect button,
  with **"The client ID is not saved yet…"** at the top of the screen: click
  **Save configuration** at the bottom of the page, then **Connect** again.
- **Redirect error while connecting**: the redirect URI of the client on the
  portal must be exactly the one shown under the Connect button.
- **"The ViCare authorization expired or was revoked"**: click **Connect**
  again. Changing the client ID also requires connecting again.
- **"ViCare API daily quota reached"**: wait for the time shown and raise the
  refresh interval.
- **A gateway is offline**: its devices keep their last values, the others
  keep being updated.
- The integration logs detail every error. They never contain your tokens.
