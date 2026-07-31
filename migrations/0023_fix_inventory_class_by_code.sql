DROP VIEW IF EXISTS vw_erp_inventory_by_item_class;
CREATE VIEW vw_erp_inventory_by_item_class AS
SELECT
  CASE
    WHEN upper(i.item_code) LIKE 'MC-%' AND upper(i.item_name) LIKE '%D400%' THEN 'D400'
    WHEN upper(i.item_code) LIKE 'MC-%' AND upper(i.item_name) LIKE '%SPORT%' THEN 'RSPORT'
    WHEN upper(i.item_code) LIKE 'MC-%' AND upper(i.item_name) LIKE '%R280%' THEN 'R280'
    WHEN upper(i.item_code) LIKE 'MC-%' THEN 'R280'
    WHEN upper(i.item_code) LIKE 'BAT%' THEN 'BAT'
    WHEN upper(i.item_code) LIKE 'BSS%' THEN 'BSS'
    WHEN upper(i.item_code) LIKE 'CHG%' THEN 'CHG'
    WHEN upper(i.item_code) LIKE 'ESP%' OR upper(i.item_code) LIKE 'SP%' OR upper(i.item_code) LIKE 'PAR%' THEN 'SP'
    ELSE 'OTH' END class_code,
  CASE
    WHEN upper(i.item_code) LIKE 'MC-%' AND upper(i.item_name) LIKE '%D400%' THEN 'Motorcycle D400'
    WHEN upper(i.item_code) LIKE 'MC-%' AND upper(i.item_name) LIKE '%SPORT%' THEN 'Motorcycle R280 Sport'
    WHEN upper(i.item_code) LIKE 'MC-%' AND upper(i.item_name) LIKE '%R280%' THEN 'Motorcycle R280'
    WHEN upper(i.item_code) LIKE 'MC-%' THEN 'Motorcycle R280'
    WHEN upper(i.item_code) LIKE 'BAT%' THEN 'Batteries'
    WHEN upper(i.item_code) LIKE 'BSS%' THEN 'Lockers / BSS'
    WHEN upper(i.item_code) LIKE 'CHG%' THEN 'Chargers'
    WHEN upper(i.item_code) LIKE 'ESP%' OR upper(i.item_code) LIKE 'SP%' OR upper(i.item_code) LIKE 'PAR%' THEN 'Spare Parts'
    ELSE 'Other Inventory' END class_name,
  i.id item_id,i.item_code,i.item_name,
  l.id location_id,COALESCE(l.code,'UNASSIGNED') location_code,COALESCE(l.name,'Unassigned') location_name,
  a.current_status,
  COUNT(a.id) quantity,
  SUM(CASE WHEN a.current_status='AVAILABLE' THEN 1 ELSE 0 END) available_quantity,
  SUM(CASE WHEN a.current_holder_name IS NOT NULL OR a.current_status IN ('ASSIGNED','LEASED','DEMO','PILOT_TEST','EMPLOYEE_ASSIGNED','INTERNAL_ASSIGNED') THEN 1 ELSE 0 END) deployed_quantity,
  SUM(CASE WHEN a.current_status='QUARANTINE' THEN 1 ELSE 0 END) quarantine_quantity,
  SUM(CASE WHEN COALESCE(a.unit_cost,0)<=0 THEN 1 ELSE 0 END) unvalued_quantity,
  ROUND(COALESCE(SUM(CASE WHEN NOT EXISTS(SELECT 1 FROM erp_fixed_asset_books f WHERE f.asset_id=a.id) THEN a.unit_cost ELSE 0 END),0),2) inventory_value
FROM erp_items i
LEFT JOIN erp_assets a ON a.item_id=i.id AND a.active=1 AND a.current_status NOT IN ('SOLD','WRITTEN_OFF')
LEFT JOIN erp_locations l ON l.id=a.current_location_id
WHERE i.active=1
GROUP BY i.id,l.id,a.current_status;
