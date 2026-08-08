-- 0064 · The signed contracts were hyperlinked all along
--
-- The lease register showed "none" under Contract file against every one of the
-- twenty-two contracts, and the uploader built in R49 sat unused. The paper was
-- not missing: column B of the SCHED sheet carries the client name, and on
-- fourteen of those rows the name is a link to the signed contract in Drive -
-- the same pattern the bank advices followed in the procurement sheet.
--
-- Filed against the lease rather than the order, matching where R49 put the
-- uploader, and keyed on the CB code so a contract lands on the right lease.
-- Henry Soesanto has seven of them and they are not the same agreement.
--
-- Re-runnable: NOT EXISTS on the same link against the same contract, so a
-- redeploy re-attaches nothing and a contract replaced by hand is left alone.

INSERT INTO erp_attachments(record_type,record_id,module_code,record_no,file_name,content_type,file_url,storage,uploaded_by,active)
SELECT 'LEASE_CONTRACT', l.id, 'SALES', l.lease_no, 'Signed contract - ' || l.lease_no || '.pdf', 'application/pdf', 'https://drive.google.com/file/d/1OfF2eKhhMj1IR2hS-YPEKxMAhwUv-RaS/view?usp=drive_link', 'DRIVE_LINK', 'lease-register@nrdev.ph', 1
  FROM erp_lease_contracts l
  JOIN erp_lease_contract_batches b ON b.lease_contract_id=l.id
 WHERE UPPER(TRIM(b.cb_code))=UPPER(TRIM('JAMO-1'))
   AND NOT EXISTS (SELECT 1 FROM erp_attachments a
        WHERE a.record_type='LEASE_CONTRACT' AND a.record_id=l.id
          AND a.file_url='https://drive.google.com/file/d/1OfF2eKhhMj1IR2hS-YPEKxMAhwUv-RaS/view?usp=drive_link' AND a.active=1);
INSERT INTO erp_attachments(record_type,record_id,module_code,record_no,file_name,content_type,file_url,storage,uploaded_by,active)
SELECT 'LEASE_CONTRACT', l.id, 'SALES', l.lease_no, 'Signed contract - ' || l.lease_no || '.pdf', 'application/pdf', 'https://drive.google.com/file/d/1b24bGNQTWQMUvL9DJX8GaIHuzOfUDq6z/view?usp=sharing', 'DRIVE_LINK', 'lease-register@nrdev.ph', 1
  FROM erp_lease_contracts l
  JOIN erp_lease_contract_batches b ON b.lease_contract_id=l.id
 WHERE UPPER(TRIM(b.cb_code))=UPPER(TRIM('BIOT-1'))
   AND NOT EXISTS (SELECT 1 FROM erp_attachments a
        WHERE a.record_type='LEASE_CONTRACT' AND a.record_id=l.id
          AND a.file_url='https://drive.google.com/file/d/1b24bGNQTWQMUvL9DJX8GaIHuzOfUDq6z/view?usp=sharing' AND a.active=1);
INSERT INTO erp_attachments(record_type,record_id,module_code,record_no,file_name,content_type,file_url,storage,uploaded_by,active)
SELECT 'LEASE_CONTRACT', l.id, 'SALES', l.lease_no, 'Signed contract - ' || l.lease_no || '.pdf', 'application/pdf', 'https://drive.google.com/file/d/1TD0hkxev5GXY308MOvcjDRLJP8yHinLs/view?usp=sharing', 'DRIVE_LINK', 'lease-register@nrdev.ph', 1
  FROM erp_lease_contracts l
  JOIN erp_lease_contract_batches b ON b.lease_contract_id=l.id
 WHERE UPPER(TRIM(b.cb_code))=UPPER(TRIM('HENR-1'))
   AND NOT EXISTS (SELECT 1 FROM erp_attachments a
        WHERE a.record_type='LEASE_CONTRACT' AND a.record_id=l.id
          AND a.file_url='https://drive.google.com/file/d/1TD0hkxev5GXY308MOvcjDRLJP8yHinLs/view?usp=sharing' AND a.active=1);
INSERT INTO erp_attachments(record_type,record_id,module_code,record_no,file_name,content_type,file_url,storage,uploaded_by,active)
SELECT 'LEASE_CONTRACT', l.id, 'SALES', l.lease_no, 'Signed contract - ' || l.lease_no || '.pdf', 'application/pdf', 'https://drive.google.com/file/d/1TD0hkxev5GXY308MOvcjDRLJP8yHinLs/view?usp=sharing', 'DRIVE_LINK', 'lease-register@nrdev.ph', 1
  FROM erp_lease_contracts l
  JOIN erp_lease_contract_batches b ON b.lease_contract_id=l.id
 WHERE UPPER(TRIM(b.cb_code))=UPPER(TRIM('HENR-2'))
   AND NOT EXISTS (SELECT 1 FROM erp_attachments a
        WHERE a.record_type='LEASE_CONTRACT' AND a.record_id=l.id
          AND a.file_url='https://drive.google.com/file/d/1TD0hkxev5GXY308MOvcjDRLJP8yHinLs/view?usp=sharing' AND a.active=1);
INSERT INTO erp_attachments(record_type,record_id,module_code,record_no,file_name,content_type,file_url,storage,uploaded_by,active)
SELECT 'LEASE_CONTRACT', l.id, 'SALES', l.lease_no, 'Signed contract - ' || l.lease_no || '.pdf', 'application/pdf', 'https://drive.google.com/file/d/1nf-ltboMMD3rhYi-kSHK7uHov9UhzJsy/view?usp=drive_link', 'DRIVE_LINK', 'lease-register@nrdev.ph', 1
  FROM erp_lease_contracts l
  JOIN erp_lease_contract_batches b ON b.lease_contract_id=l.id
 WHERE UPPER(TRIM(b.cb_code))=UPPER(TRIM('PMI-1'))
   AND NOT EXISTS (SELECT 1 FROM erp_attachments a
        WHERE a.record_type='LEASE_CONTRACT' AND a.record_id=l.id
          AND a.file_url='https://drive.google.com/file/d/1nf-ltboMMD3rhYi-kSHK7uHov9UhzJsy/view?usp=drive_link' AND a.active=1);
INSERT INTO erp_attachments(record_type,record_id,module_code,record_no,file_name,content_type,file_url,storage,uploaded_by,active)
SELECT 'LEASE_CONTRACT', l.id, 'SALES', l.lease_no, 'Signed contract - ' || l.lease_no || '.pdf', 'application/pdf', 'https://drive.google.com/file/d/1pdznZO39NGXDBsUR3KXk65pw_c76BO-e/view?usp=drive_link', 'DRIVE_LINK', 'lease-register@nrdev.ph', 1
  FROM erp_lease_contracts l
  JOIN erp_lease_contract_batches b ON b.lease_contract_id=l.id
 WHERE UPPER(TRIM(b.cb_code))=UPPER(TRIM('AMCO-1'))
   AND NOT EXISTS (SELECT 1 FROM erp_attachments a
        WHERE a.record_type='LEASE_CONTRACT' AND a.record_id=l.id
          AND a.file_url='https://drive.google.com/file/d/1pdznZO39NGXDBsUR3KXk65pw_c76BO-e/view?usp=drive_link' AND a.active=1);
INSERT INTO erp_attachments(record_type,record_id,module_code,record_no,file_name,content_type,file_url,storage,uploaded_by,active)
SELECT 'LEASE_CONTRACT', l.id, 'SALES', l.lease_no, 'Signed contract - ' || l.lease_no || '.pdf', 'application/pdf', 'https://drive.google.com/file/d/1FIx8rSGOVvb46oiv7nv5uzTbrgZDbt55/view?usp=drive_link', 'DRIVE_LINK', 'lease-register@nrdev.ph', 1
  FROM erp_lease_contracts l
  JOIN erp_lease_contract_batches b ON b.lease_contract_id=l.id
 WHERE UPPER(TRIM(b.cb_code))=UPPER(TRIM('AMCO-2'))
   AND NOT EXISTS (SELECT 1 FROM erp_attachments a
        WHERE a.record_type='LEASE_CONTRACT' AND a.record_id=l.id
          AND a.file_url='https://drive.google.com/file/d/1FIx8rSGOVvb46oiv7nv5uzTbrgZDbt55/view?usp=drive_link' AND a.active=1);
INSERT INTO erp_attachments(record_type,record_id,module_code,record_no,file_name,content_type,file_url,storage,uploaded_by,active)
SELECT 'LEASE_CONTRACT', l.id, 'SALES', l.lease_no, 'Signed contract - ' || l.lease_no || '.pdf', 'application/pdf', 'https://drive.google.com/file/d/1qWiMa4fILBoWHSlgOAORxmKFLAVHgyHd/view?usp=sharing', 'DRIVE_LINK', 'lease-register@nrdev.ph', 1
  FROM erp_lease_contracts l
  JOIN erp_lease_contract_batches b ON b.lease_contract_id=l.id
 WHERE UPPER(TRIM(b.cb_code))=UPPER(TRIM('MFSS-1'))
   AND NOT EXISTS (SELECT 1 FROM erp_attachments a
        WHERE a.record_type='LEASE_CONTRACT' AND a.record_id=l.id
          AND a.file_url='https://drive.google.com/file/d/1qWiMa4fILBoWHSlgOAORxmKFLAVHgyHd/view?usp=sharing' AND a.active=1);
INSERT INTO erp_attachments(record_type,record_id,module_code,record_no,file_name,content_type,file_url,storage,uploaded_by,active)
SELECT 'LEASE_CONTRACT', l.id, 'SALES', l.lease_no, 'Signed contract - ' || l.lease_no || '.pdf', 'application/pdf', 'https://drive.google.com/file/d/1TlMCc4fi1i1KNXefj74HLbocY0-Is519/view?usp=sharing', 'DRIVE_LINK', 'lease-register@nrdev.ph', 1
  FROM erp_lease_contracts l
  JOIN erp_lease_contract_batches b ON b.lease_contract_id=l.id
 WHERE UPPER(TRIM(b.cb_code))=UPPER(TRIM('WEMV-1'))
   AND NOT EXISTS (SELECT 1 FROM erp_attachments a
        WHERE a.record_type='LEASE_CONTRACT' AND a.record_id=l.id
          AND a.file_url='https://drive.google.com/file/d/1TlMCc4fi1i1KNXefj74HLbocY0-Is519/view?usp=sharing' AND a.active=1);
INSERT INTO erp_attachments(record_type,record_id,module_code,record_no,file_name,content_type,file_url,storage,uploaded_by,active)
SELECT 'LEASE_CONTRACT', l.id, 'SALES', l.lease_no, 'Signed contract - ' || l.lease_no || '.pdf', 'application/pdf', 'https://drive.google.com/file/d/1LV0bdO_LmsqNP-eDmn5-Rq947j6q6lio/view?usp=sharing', 'DRIVE_LINK', 'lease-register@nrdev.ph', 1
  FROM erp_lease_contracts l
  JOIN erp_lease_contract_batches b ON b.lease_contract_id=l.id
 WHERE UPPER(TRIM(b.cb_code))=UPPER(TRIM('UMFS-1'))
   AND NOT EXISTS (SELECT 1 FROM erp_attachments a
        WHERE a.record_type='LEASE_CONTRACT' AND a.record_id=l.id
          AND a.file_url='https://drive.google.com/file/d/1LV0bdO_LmsqNP-eDmn5-Rq947j6q6lio/view?usp=sharing' AND a.active=1);
INSERT INTO erp_attachments(record_type,record_id,module_code,record_no,file_name,content_type,file_url,storage,uploaded_by,active)
SELECT 'LEASE_CONTRACT', l.id, 'SALES', l.lease_no, 'Signed contract - ' || l.lease_no || '.pdf', 'application/pdf', 'https://drive.google.com/file/d/1-K2gwYDth5vDCk6vVjQ0gLRg4BSHSOfu/view?usp=drive_link', 'DRIVE_LINK', 'lease-register@nrdev.ph', 1
  FROM erp_lease_contracts l
  JOIN erp_lease_contract_batches b ON b.lease_contract_id=l.id
 WHERE UPPER(TRIM(b.cb_code))=UPPER(TRIM('API-1'))
   AND NOT EXISTS (SELECT 1 FROM erp_attachments a
        WHERE a.record_type='LEASE_CONTRACT' AND a.record_id=l.id
          AND a.file_url='https://drive.google.com/file/d/1-K2gwYDth5vDCk6vVjQ0gLRg4BSHSOfu/view?usp=drive_link' AND a.active=1);
INSERT INTO erp_attachments(record_type,record_id,module_code,record_no,file_name,content_type,file_url,storage,uploaded_by,active)
SELECT 'LEASE_CONTRACT', l.id, 'SALES', l.lease_no, 'Signed contract - ' || l.lease_no || '.pdf', 'application/pdf', 'https://drive.google.com/file/d/1u1W879m2w-qauoe2Z3px0rgra893cBvp/view?usp=drive_link', 'DRIVE_LINK', 'lease-register@nrdev.ph', 1
  FROM erp_lease_contracts l
  JOIN erp_lease_contract_batches b ON b.lease_contract_id=l.id
 WHERE UPPER(TRIM(b.cb_code))=UPPER(TRIM('CCI-1'))
   AND NOT EXISTS (SELECT 1 FROM erp_attachments a
        WHERE a.record_type='LEASE_CONTRACT' AND a.record_id=l.id
          AND a.file_url='https://drive.google.com/file/d/1u1W879m2w-qauoe2Z3px0rgra893cBvp/view?usp=drive_link' AND a.active=1);
