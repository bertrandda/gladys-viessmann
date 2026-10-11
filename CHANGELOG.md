# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Viessmann ViCare account linking from the Gladys Configuration screen
  (OAuth2 with PKCE, client ID of the Viessmann developer portal).
- One thermostat per heating circuit: target temperature (setpoint of the
  active program), mode, operating state, room and supply temperatures.
- Domestic hot water as a water heater: target temperature, mode (E3
  appliances and heat pumps), one-time charge, charging state and tank
  temperature.
- Heat generator sensors: outside, boiler, supply and return temperatures,
  burner and compressor activity, starts and operating hours, today's gas and
  power consumption.
- Refresh loop sized for the ViCare API quota (one call per gateway, interval
  multiplied by the number of gateways), paused until the quota renews when it
  is exhausted.
- "Test the connection" button in the Configuration screen.
- Documentation in English and French.

[Unreleased]: https://github.com/bertrandda/gladys-viessmann/commits/master
