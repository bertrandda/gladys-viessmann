# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Changed

- Gladys integration SDK updated to 0.15.0.
- Configuration screen in two numbered steps: the client ID and the refresh
  interval first, then the ViCare account with the Connect button, so that
  "Save configuration" clearly comes before "Connect". Clicking Connect before
  saving the client ID now says to save first, and the status confirms the
  saved client ID.

## [1.0.0] - 2026-10-11

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

[Unreleased]: https://github.com/bertrandda/gladys-viessmann/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/bertrandda/gladys-viessmann/releases/tag/v1.0.0
