-- Supplier responses to engagement requests (contact handover to the buyer).
ALTER TABLE engagement_requests
  ADD COLUMN supplier_response jsonb,
  ADD COLUMN responded_by      uuid REFERENCES users(id),
  ADD COLUMN responded_at      timestamptz;
CREATE INDEX engagements_buyer_idx ON engagement_requests (buyer_organization_id, created_at DESC);
