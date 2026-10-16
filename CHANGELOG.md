# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.1.0] - 2026-10-16

### Added

- "Heating schedule" dashboard widget: the active program, the live setpoint,
  the ViCare weekly schedule and the heating curve (slope and shift) of a
  heating circuit, with no extra API call. Its "Heating curve" button changes
  the curve (Gladys 5.2 or later).
- Documentation: using a circuit as an external thermostat of Gladys 5.2, the
  meaning of the hot water "Eco" mode, adjusting the heating curve.

### Changed

- The Configuration screen lists the setup steps and insists on saving the
  client ID before clicking Connect. The errors of the Connect button are in
  English and French.

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

[Unreleased]: https://github.com/bertrandda/gladys-viessmann/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/bertrandda/gladys-viessmann/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/bertrandda/gladys-viessmann/releases/tag/v1.0.0
