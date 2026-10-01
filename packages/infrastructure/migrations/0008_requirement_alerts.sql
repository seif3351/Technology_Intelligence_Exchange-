-- Opt-in alerts when a newly listed offering meets all hard constraints of a saved requirement.
CREATE TABLE requirement_watches (
  requirement_id  uuid PRIMARY KEY REFERENCES requirements(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  user_id         uuid NOT NULL REFERENCES users(id),
  created_at      timestamptz NOT NULL
);

-- One notification per requirement and offering.
CREATE TABLE requirement_alerts (
  requirement_id uuid NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
  offering_id    uuid NOT NULL REFERENCES offerings(id) ON DELETE CASCADE,
  notified_at    timestamptz NOT NULL,
  PRIMARY KEY (requirement_id, offering_id)
);
