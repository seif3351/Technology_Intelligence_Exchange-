# Automotive technology ontology

Source of truth: `data/ontology/` (YAML). Loaded into PostgreSQL by `pnpm db:seed`; admins can add concepts via `POST /v1/admin/concepts`.

## Facets

application-domain · capability · ai-ml · software-architecture · middleware · communication-protocol · networking · operating-system · hardware-platform · functional-safety · cybersecurity · process-standard · data-format · tooling. Each facet defines the default requirement level (e.g. safety and security standards default to _experience_).

## Relations

| Relation     | Meaning                                                                                                                                               | Used for satisfaction                                            |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `is_a`       | subsumption (AUTOSAR Adaptive is_a AUTOSAR; NVIDIA DRIVE Orin is_a compute platform; ISO 26262 is_a functional safety; PTP is_a time synchronization) | ✅ a claim on a narrower concept satisfies a broader requirement |
| `part_of`    | composition (ara::com part_of AUTOSAR Adaptive; ASIL part_of ISO 26262; TARA part_of ISO/SAE 21434; perception part_of ADAS)                          | ❌ (shown as related)                                            |
| `uses`       | technical dependency (AUTOSAR Adaptive uses SOME/IP; Ethernet TSN uses PTP)                                                                           | ❌                                                               |
| `related_to` | association (SOTIF related_to functional safety)                                                                                                      | ❌                                                               |

## Examples encoded

- AUTOSAR → Adaptive / Classic; Adaptive uses SOME/IP, diagnostics, UDS; ara::com part_of Adaptive.
- NVIDIA DRIVE Orin / Thor, Snapdragon Ride, R-Car, TDA4, S32G, AURIX → compute platform.
- QNX, Linux (AGL), Android Automotive, Zephyr → operating systems.
- SOME/IP, CAN (case-sensitive alias), CAN FD, LIN, FlexRay, UDS, DoIP, MQTT; Automotive Ethernet, Ethernet TSN, PTP/gPTP.
- ADAS ← perception, sensor fusion, planning; simulation, scenario-based testing, HIL/SIL, validation, testing.
- Functional safety ← ISO 26262 (ASIL), SOTIF, ISO/PAS 8800; cybersecurity ← ISO/SAE 21434 (TARA), UNECE R155/R156, secure boot, SecOC, HSM.

## Extending

Add a concept to the right `concepts/*.yaml` file with a kebab-case `id`, `facet`, `label`, `aliases`, `description` and relations; run `pnpm db:seed`. Never rename ids — deprecate (`status: deprecated`). This ontology is intentionally incomplete; extend it from real supplier and buyer data.
