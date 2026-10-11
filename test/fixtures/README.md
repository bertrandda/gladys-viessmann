# Test fixtures

ViCare API answers used by the tests (no test touches the network):

- `installations.json`: `GET /equipment/installations?includeGateways=true`
  for one installation with two gateways (a boiler, and a heat pump next to a
  room control the integration ignores).
- `gateway-boiler.json`, `gateway-heatpump.json`:
  `GET /features/installations/{id}/gateways/{serial}/features?includeDevicesFeatures=true`.
- `errors/`: error payloads (quota exhausted, gateway offline).

The feature payloads are trimmed from the Vitodens 200-W and Vitocal 250-A
fixtures, and the error payloads copied from the fixtures, of
[PyViCare](https://github.com/openviess/PyViCare) (Apache-2.0), with the URIs
rewritten to the current API host and anonymized serial numbers.
