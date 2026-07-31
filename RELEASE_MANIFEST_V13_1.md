# E88 Enterprise ERP v13.1 Release Manifest

- Build: `E88-ROLLOUT-ERP-20260731-R13.1`
- Files: 153
- D1 binding: `DB`
- R2 binding: `DOCS`
- R2 bucket: `e88-erp-documents`
- Validation: 374/374 structure, 24/24 Node, 73/73 data/accounting, 9/9 workbook hashes

## File hashes

| Path | Bytes | SHA-256 |
|---|---:|---|
| `.dev.vars.example` | 213 | `acf46067d97160601eb3aaf058b07c32cf9bc050f14a0b671e9d908cb833e8eb` |
| `.github/workflows/deploy-e88-erp.yml` | 6,759 | `60eaa9cc70ccf6cdd265e7fc9f2864e9b361d3d6e7fed345f7eb8ade6efc72ee` |
| `.gitignore` | 91 | `6a191fd4b8f95e26f2e2ef02be8bf4f0e7f98eeec89cf252721953d45c0cc93e` |
| `0014_application_auth.sql` | 1,701 | `4b0ab1dfd4731d0a62134382134b48ddb83b91ac008102b9ecb677eefe615e00` |
| `ADMIN_GUIDE_V13.md` | 1,635 | `9471b352da49068944cc1abe1baaf1bfc80397c243b649edd77ae2daa82d7d8a` |
| `ARCHITECTURE.md` | 4,164 | `21a50a0c7f244adb7767cdfb23111e92173ef69f5d3507512163c3a26c6ce6e9` |
| `BUILD_COMPLETION_REPORT.md` | 4,192 | `9dbc5afe207e9ed13f643dd925cde94148ef593ab001b110a4016ee4405d07d5` |
| `BUILD_COMPLETION_REPORT_V13_1.md` | 4,837 | `1feb0d20680a38d310e2ad41bb682bf46727a8f1f39853d21a1d6cbe89935a75` |
| `CHANGELOG.md` | 6,980 | `a738cecd0fa3ffda94c9882077181e3df65b9e2d82f9f5f7531feff2e0afa907` |
| `COPYRIGHT_NOTICE.md` | 688 | `b440ee30006cd1c0d40b7c6b318a03df7aa4b06f16a5003531facf3aced3d881` |
| `DELIVERY_NOTES_V8_1.md` | 2,964 | `b8f5b1a3adeac0b3583a11fa7dc768491c61a9fca3116bb76bd2a3a5d9042e61` |
| `DEPLOYMENT.md` | 2,814 | `0f616d238567bd4877df6dd6a7f14747d83a388de223acd7fa1baf6a432e32c1` |
| `DEPLOY_GITHUB_R2_V13_1.md` | 9,550 | `2ef28ce89f446607eb8d94285ef7de2bef2e29403dfb864cd195777a8c07b7b0` |
| `GITHUB_BROWSER_DEPLOYMENT.md` | 2,130 | `df50f30e3b42f5e3a1f1bfd4ab29e65d7af8a3ba58aa94db1ff3ff1f14536452` |
| `GO_LIVE_CHECKLIST.md` | 2,574 | `ded1ef02981fb302408fb5b0509b1596607b381722f53c35bc717a0f83c0afb8` |
| `LOGIN_REPAIR_V8_1_1.md` | 1,454 | `c768276a298d187ede84808cd3e7f44c43923e1e5ff5ee360de34a8c3ebae605` |
| `README.md` | 4,438 | `df2daa9077678adc870cd395f46c8a9ec91b9b19a2da6e4e050b95b17af01e59` |
| `ROLLOUT_READINESS_V13.md` | 2,345 | `06ce181855e2391f1045e9e0c387d3fba44010008bc6bb2419a73cd0c977e817` |
| `UAT_SCENARIOS_V13.md` | 2,455 | `9b69275338ce782ac2b57bf602295f4df5c39583f40fd17330ffb8d4e118402a` |
| `UPGRADE_V12.md` | 1,716 | `a0172fecf8a0daa0e544dca15d28c283ea85152961662a5d670ee4655d931c4b` |
| `UPGRADE_V13.md` | 1,420 | `e288578cdac59e929b981f1fabe3185bea6fdebd4894e7219cb090e80b39a6b9` |
| `USER_GUIDE_V13.md` | 1,519 | `ceed73ca287ff956ca173940f9e7d5c0be9a3ee62070d3f0df262c074d8da932` |
| `admin.js` | 8,134 | `aaecc42a46447ccf9246ed27eeed0ca70e890620f5300e0a5620927d8f87d7fd` |
| `alter_users.sql` | 58 | `21d00f606fa609298e4a3ee935d1ac6a253afebc979829db027435c02c05c358` |
| `app.css` | 17,799 | `2ef0ac09489ad5b4e0ba3d7032d3f4af0dca04d591f85619a1dd3784125a9527` |
| `app.js` | 62,037 | `5912dfa5fa510d8f02fffdf4e2abf2622a49d2bebb06dfc51434da54cf897ffc` |
| `apply-database.mjs` | 3,200 | `908d98ec97cd9784fb903c537209c56ecc5227852ba29fdf0416926645eb62d0` |
| `auth.integration.mjs` | 4,701 | `1ce08c527127191b38a280ab6a2cb0a70d4e374ba7874f3619d5f6af623ee1d4` |
| `auth.js` | 8,571 | `ae3aa5746f63dd4eeb6320c0ba8567310e9be8f3235162d559d53b987f336975` |
| `auth.test.mjs` | 1,308 | `31838cbe573f15253e20a03dfdba5e29615b9b7f277430d528e5c190040b4e4c` |
| `check-structure.mjs` | 7,249 | `28fecba999cb08783f25203b4abf82bf333562cb5ad0634a03bb2ac192a67725` |
| `crypto.js` | 2,740 | `537a212a4254fcc99b6100dba73c69da9a69b06c0ec13a976fba9c156f0564bd` |
| `data.sql` | 827,996 | `f6904f93225f05dcea3d4e7c01e9d1f0eeb066322bca4582adbab9e32d4a78fc` |
| `index.html` | 2,705 | `c2eb13be94b1494702a7c4753b5535e644b219fddb2c35bd11f181558b91b8d8` |
| `index.js` | 2,727 | `cef85291ad20638993fe39fcc8aab1c3bf45c24bea710e393ae23fcdf2e434dd` |
| `loc_backfill.sql` | 34,978 | `5db5d44c873cd5810cbc319c812f806db00da91e0d8f9a849043c25d74478bf5` |
| `logo.png` | 8,450 | `1a15d9b86d6e4d7db36eaee8dd5f558392f7b0c457c261189e300c7184708619` |
| `migrations/0008_connected_erp.sql` | 20,267 | `096bc12a489b1cc07241721bf16b0dac876c22294df84245007d0ea01fdeebe4` |
| `migrations/0010_procurement_sales_controls.sql` | 5,306 | `3e4f5628e07bb9b0f68cf8f75199ee926e62ed3a2cb61bda42fa073d2fe4f429` |
| `migrations/0011_finance_planning_registers.sql` | 5,508 | `f4443aa951f64c0ad64f51157cdd1d436ba38ce4036a42dbbd837b11e9c426e2` |
| `migrations/0012_ramco_enterprise.sql` | 11,546 | `0e711122ab2b16401e3561f2a4697db8041d558130999b5e14fee8b4cf432c8e` |
| `migrations/0013_atlas_receiving_workbench.sql` | 3,408 | `364692a53c051f641ab1143b08b4547d7bb385a51ce236770797d108e21a0ce0` |
| `migrations/0014_application_auth.sql` | 1,701 | `4b0ab1dfd4731d0a62134382134b48ddb83b91ac008102b9ecb677eefe615e00` |
| `migrations/0015_user_access_station_connections.sql` | 775 | `fbef38674acafea759c97e9cc0b9ffd1fa9590691cb5bf12e74b3608037291e8` |
| `migrations/0016_clean_module_workspace.sql` | 1,664 | `63df5787ffe7857dc411477ff54d3a3cc877f305d8304630c9c89e92eafaa8f1` |
| `migrations/0017_inbound_logistics_control.sql` | 7,943 | `ef0152d10d7cc5b6f9d80e37911eb460e0a7cc6d21143ce896380d0609b59c99` |
| `migrations/0018_sales_distribution_custody.sql` | 8,801 | `df3ada21a0fce19bd5691a520ff63a21008b50984fe8cfeb3fb6d44a04e7e23d` |
| `migrations/0019_connected_finance_engine.sql` | 27,818 | `251150d5c28e47c0401e0fe048328d73f771817219bd129cef1d1b5937ba6b77` |
| `migrations/0020_operational_submodules_and_posting_rules.sql` | 32,313 | `328a0e1fe0e03d6b99037bcb7c3215d0d68d18b520e4fe327384341a147d632a` |
| `migrations/0021_rollout_specialist_engines.sql` | 35,407 | `05f4f92c4bfcc62c0b2da566dc3bf174cd1829a687bb8bd3fb24db8f1860e92a` |
| `migrations/0022_inventory_class_r2_rollout.sql` | 14,493 | `888e72f7e96a813fa0e71abe93ed1d7e31e361fce1a123b0b53a6c354163c9e8` |
| `migrations/opening/0001_opening_data.sql` | 1,683,923 | `2d0d62228db130647160f0582e46d1361acbcef7a7991e87a38df46245e0ac19` |
| `migrations/opening/0002_opening_data.sql` | 3,020,189 | `628d714ee10451cb18a3d5e5fd0543a8894265c15fbd4de7685db9c01d8ba877` |
| `migrations/opening/0003_opening_data.sql` | 3,424,033 | `f8c135af27bac201858afbe2d65a64630393b7924a7d40cea7e684d8e76b4f6f` |
| `migrations/opening/0004_opening_data.sql` | 3,158,607 | `b4f565640b6063183810b1e97f7d8c4d0daa83e1b9a8f9be3c12adb83fcee763` |
| `migrations/opening/0005_opening_data.sql` | 1,734,658 | `ea1af0ef52521c41d0745c8ac2c3c4f38b11ac107497494508c278856bb34c4b` |
| `migrations/opening/0006_opening_data.sql` | 3,824,232 | `d8419a8136ee2f3e38f2a204aed35c1ceb991a87dec70dbd3ffef5a1fbd2721b` |
| `migrations/opening/0007_opening_data.sql` | 4,912,914 | `0b9ab5b76b0b701d8a2237727546d21d65cc6acad750f6af3c01736c4c82b0bc` |
| `migrations/opening/0008_opening_data.sql` | 1,743,422 | `008cd9dbfa9e12e2a7b1e5d9ea97702fb3ca70006cbb42225e99a85311424466` |
| `migrations/opening/0009_opening_data.sql` | 119,610 | `7954ef27e2f99fc9edcc328b79c35b00cd62e165db739657d66bc118cd2e97c8` |
| `migrations/opening/manifest.json` | 303 | `be1587ecb8a71c3af235d00ba14d69c7d07974cf3581392d87d1f8d4436b7edd` |
| `package-lock.json` | 53,403 | `3e306f86e0f238d0fd7d56744f56333f9f3b144a06dd70851ec63c19eaffdef1` |
| `package.json` | 1,354 | `8ed7838c160eab34d0f5d37714d8a5cd8d6bcb3eed3f7b598b68b371ef0b8879` |
| `public/foundation.css` | 41,943 | `b473fe9cbb6cd75769fed8dfb95dd232baef509c613790c080306aea6f9f601b` |
| `public/foundation.js` | 262,542 | `e3f012c08b3b7c81a3a01788d3ea04bcf909e5ff8db36e70b5d6ac3a28f7239f` |
| `public/index.html` | 2,742 | `ede3c49a2bcc65c041fbc1dfef22eb7a7f9ebae992c23d33964d8ea735246a88` |
| `public/logo.png` | 8,450 | `1a15d9b86d6e4d7db36eaee8dd5f558392f7b0c457c261189e300c7184708619` |
| `reports/BUILD_VALIDATION.md` | 1,121 | `e797fd74ff37ab12c092296c22f503b47a467e012a7676db81607ea432565831` |
| `reports/BUILD_VALIDATION_V13.json` | 2,171 | `d9d7553bf3c86d8337e0104e31caaa587a22a003943d66a3dfe9d1e9b5426f1e` |
| `reports/BUILD_VALIDATION_V13.md` | 2,028 | `43e36436fcb7137cc9ce633cb5f667068d79102eb39d53e166012ce0ab43673d` |
| `reports/BUILD_VALIDATION_V13_1.json` | 2,734 | `1d31a9d68cf494988d4c5ef643fde7c6ca9a2e0cf4fb6539d668ab66f67055c8` |
| `reports/BUILD_VALIDATION_V13_1.md` | 1,651 | `4f002b29874638256ccdd4f61ed20c0cd718d3027580fd8d2a3de4c6be16e8b4` |
| `reports/CHANGE_SUMMARY_V13.md` | 929 | `b2cedbdaac6394c81a63542a804efc3167d2c8842958a40a378cb9370eb169f4` |
| `reports/DATA_LOAD_REPORT.json` | 2,353 | `98e8b653e99769744f320eed92b441dc69b4efb3059cc15308a982167890c62c` |
| `reports/DATA_LOAD_REPORT.md` | 906 | `054601f950c96f5e4faaff5c8e455b1ed7844393d4678031de28b8e46e5bbbf1` |
| `reports/DATA_TEST_V13_1.json` | 1,669 | `6a374bb56c13078b4faa25e1cfc88ba391540b46c5bd5a4531ac7e4fa58d8676` |
| `reports/GIT_CHANGE_SUMMARY.txt` | 456 | `6dd7590f4eab677c92f6c47a1f7fb5c1faf819996ea50de006f4acb690c33407` |
| `reports/SELF_TEST_REPORT.json` | 12,006 | `dbc3944b5c96241eccb553c61faa46a48bb9b80bc63f85a8f57c6b71182956ad` |
| `reports/SELF_TEST_REPORT.md` | 8,397 | `088861e7d03d81a600bc6ef0a90048e51e065d71dafc9683985fd607e94adf16` |
| `reports/SOURCE_SECURITY_REPORT.md` | 630 | `78cf3dd37ee96dcbac428705747184fc23bafcb087b5634be8e6460be0ebe3ed` |
| `reports/SOURCE_SECURITY_REPORT_V13.md` | 585 | `10cf6b1fd36a743cc3ede1115e0a9a0e74a94cf986ecb256f8d669aa5e3a0cf2` |
| `reports/STRUCTURE_CHECK_V13_1.txt` | 21,016 | `6239d7e10949dd10fa58c458328daf3a33c0300562d198d07cfc6c14a27212c0` |
| `reports/UNIT_TEST_V13_1.txt` | 5,172 | `318153a3613622e62907e4975d4da79ee6de16300753527aba13133047ce8ae7` |
| `schema.sql` | 5,570 | `4acc7ff967c8d8923d3f4fec84f1d4a021a30d94ad88dff747826b3a2171ca24` |
| `schema2.sql` | 5,625 | `571bf91af4e9be23f3836730e2e2f0d7517d52c6e8eda2ce26c7660f7b6c4958` |
| `schema4.sql` | 3,637 | `d58dadf05a75d18318b9093f4ac99b285e67173dbd062612d4aa5ad919ccda4e` |
| `schema7.sql` | 341 | `1b7d8b17bf9540af1004d064b804e93d1b8786a502036917944c247bf4ce4253` |
| `scripts/apply-database.mjs` | 3,200 | `908d98ec97cd9784fb903c537209c56ecc5227852ba29fdf0416926645eb62d0` |
| `scripts/check-structure.mjs` | 8,158 | `8134c947c315b85d5da5af7f08d91b835a99ff8d928d063a2fdbfa5662838b25` |
| `scripts/generate_opening_data.py` | 72,075 | `6031315672891bbad4c08cb49997710f71a78911556f9b4df2648ca363229327` |
| `scripts/predeploy-guard.mjs` | 1,124 | `c1431f253fca1eb7c8ab9facf5df6913213ca24778f6eb2ec03d8f20d02ceb87` |
| `scripts/self_test.py` | 23,200 | `dc288f4d841c31a2e7166855ee94b23c331704f63ef222cab1c7ac9c0b7de46e` |
| `scripts/smoke-test.mjs` | 1,478 | `9e61824f85942d370703cfea502039de671cc871c0505ee435b98f25ff4d114e` |
| `scripts/verify-empty-d1.mjs` | 2,786 | `bb079e99cd089b756d02699e58c8271a076c6c9655922141b8e825cd20fd7ee6` |
| `source_data/2026 SCM Warehouse Documents.xlsx` | 2,458,348 | `f106731e56053057a6cdd372ab069a433bd29a8a9333d2a2591b9e74c1e382de` |
| `source_data/ATLAS - Asset Manifest (1).xlsx` | 234,698 | `fae086fdc52b0e70a5cbcbe520b11230913c52f5640f08cde13e75921fc8551a` |
| `source_data/Detailed_Receipts_2026.xlsx` | 66,257 | `1e8573e5d50068ac1479aee082fbcf673e94459a446617df64379e55866f9eea` |
| `source_data/E88_AM_FINAL_v5A.xlsx` | 817,942 | `639f42b10985478b69d4299861b8994105128dd541a280f17d6ebc0c20de7532` |
| `source_data/E88_ApprovedBudget2026 (4)(1).xlsx` | 254,256 | `22ac899849ed28955ea5924c609a4dd106285796a406960ffb31f8a453fb0c1a` |
| `source_data/E88_ProcurementMonitoring_2026.xlsx` | 781,847 | `492e2e42fa82200d08dc585a5c7f938ef1e447379c6d04fc594ffa4e0314a66c` |
| `source_data/E88_SalesMonitoring_2026.xlsx` | 136,132 | `31bbb24140ae186f05c47efe070534cbdae1e1bdfa1a03d0ceb39717d68dec95` |
| `source_data/Pre-release Unit Checklist.xlsx` | 177,618 | `47fc691627c808e714e42d06261b4cf5287a1c3ee2ed3ef338723be77748ea66` |
| `source_data/SATURN _ DELIVERY MONITORING _ LAST MILE (3).xlsx` | 830,159 | `f5a0734ef12faaeced254fb95b7df7b0442cc38ac56b33493659cbcb18244e38` |
| `source_data/SCM Live Dashboard (3).xlsx` | 482,927 | `870bb5bff79cc5ffaf4ef8f62bea9406ebde20bd187a420314738ca35f352912` |
| `source_data/SCM Requisition Slip 1226.xlsx` | 174,555 | `29d29a7e7aba69e90d67d6af28634985d362436c385faa456aa8c78992cc3d52` |
| `source_data/STAKU - SALES_LEASE B2B (4).xlsx` | 459,490 | `532b252c8ec950ae2d8667b17b232afeb7ada57e67e13bcd047891e1cdb3d95a` |
| `source_data/STAR _ E88 SCM Inventory2026 (4).xlsx` | 2,570,985 | `eb1c9886906857c79198583b11405a8b35459c18bd0abbdcb5a7036a1324ab5f` |
| `source_data/STELLAR _ Shipment.xlsx` | 185,293 | `80128523048563985df5791c2478312df8a2b27cebe29522410f1352e785321e` |
| `src/.gitkeep` | 12 | `2f73349cfc4630255319c6c8dfc1b46a8996ace9d14d8e07563b165915918ec2` |
| `src/index.js` | 3,811 | `e13dc58f24f93ca56b8279d62001fc6c24ef9913e26cc84b42914b68fffcb681` |
| `src/lib/atlas.js` | 7,533 | `1373cd47b7722aa452fc5312205a7119623728fa3b4b320cfaf06799c14355e7` |
| `src/lib/audit.js` | 715 | `d1715b19664d655a052a9f3afdc30ac51b9e6cab0388b2171be4fea29db0e308` |
| `src/lib/auth.js` | 5,995 | `c18b056b8c3193afa50378f37808cdbe439d98e5be12e1efc7917493cc8725b1` |
| `src/lib/codes.js` | 4,536 | `834cd5121cc7631d6b146eed40ef598b027f2d940a7ede50ca1c6de61a191554` |
| `src/lib/crypto.js` | 2,740 | `c7548b1922eba056492a286c47bc1f8c353bd39457a0c76ef1f0d585902e7af8` |
| `src/lib/db.js` | 999 | `cc5d816d0c1f3abd1281b3e9c96665ba6848ad427532b034d1e05d295ddcbe1a` |
| `src/lib/finance.js` | 37,739 | `02d14eeec5fe0f6ae44740362720d48125ffc4971ecf74b581f84340eb11ad3e` |
| `src/lib/http.js` | 1,082 | `74d2a07d8e67c6daca791618330d005adc758ae4c6741db0dd194fff5f367ae5` |
| `src/lib/inventory.js` | 5,632 | `a8e5e5e618d180ad2c8e32ce75e1d32f19d13e00ae3caa984228cdc21053d00d` |
| `src/lib/module-definitions.js` | 68,125 | `c451c90ce03b49a574d1f5fbc6af6bc172cfb3a435e3fc5ed82617e4ec4c7425` |
| `src/lib/receiving.js` | 8,089 | `0441c9353115ec358692d0e804423935c5e162186a2beb686b1f2b2dba640cde` |
| `src/lib/specialist-engine.js` | 62,383 | `104f35e6b9e99b047bf2463d1aaf2f20dd6c004681919e79f2f6431202b67a67` |
| `src/lib/transaction-rules.js` | 8,504 | `eeffffd1841e133e2a6a78e608382c80a31ee8efe8181235a4a5ecd11d009fdd` |
| `src/lib/workspace.js` | 7,178 | `610c2a5e7f9bacfa28f2d1f04b7c318e5b908afed278cb31f2ff224c0ce01a32` |
| `src/routes/admin.js` | 12,226 | `ef0c34037dd1ad9ecdf0ad91f5f386622af66f9b2b5cf084ddad083219e1101c` |
| `src/routes/atlas.js` | 11,600 | `6bab9a4e6ce607208af89fefdf580dc29fc2d6f05ebc74dd70c0736797b9c7d8` |
| `src/routes/auth.js` | 8,571 | `ae3aa5746f63dd4eeb6320c0ba8567310e9be8f3235162d559d53b987f336975` |
| `src/routes/checklists.js` | 1,849 | `8967c0ec02930f129eb9c097b91b2bd8126359f834e6628b408add799198af38` |
| `src/routes/dashboard.js` | 4,253 | `5c0a4b9a2912fecbf12d44e2657b8261921395e3af4c59a1175df757a87023de` |
| `src/routes/deliveries.js` | 19,854 | `5ca2fa778f01d3fe0b41132cbc09f9d85ca3d172ff6ec4e853b8bbcdcb87f648` |
| `src/routes/enterprise.js` | 6,874 | `beb0587d45bd56b84380866e03a09a13b17f134707eff3532e8635645ced335a` |
| `src/routes/finance.js` | 74,322 | `896f26850a6b9cab10bb04d075f2f107b166c822c31f64abebf52793516382af` |
| `src/routes/inventory.js` | 39,689 | `e96118cb7296361c107aec85d4dcad6240ccf9e30fa88313c5396d38be4498c5` |
| `src/routes/masters.js` | 4,931 | `deb4922b0f0c2a1ba8748166e4aeb1760ae4aac2e95434586e8724e7f6ca9427` |
| `src/routes/planning.js` | 7,243 | `016d0fbadf4c97fbf04eb19e5e48268351255f6643a62dec0d39b35502c52d20` |
| `src/routes/procurement.js` | 11,823 | `0742c0770e2f670d5995f1f968636641492ceb1c039e4343eea2a3ff9a4523a6` |
| `src/routes/receiving.js` | 17,972 | `efc7b95f80cb226ac3fb142ff54f99369b19aea73fbf89122240a33a28dd8a9f` |
| `src/routes/requisitions.js` | 19,886 | `3bfceffeebd833df9934b3c5fa368fe38bb132043c41c8aa45ff7504d7e24cc9` |
| `src/routes/returns.js` | 23,932 | `bd787c3923b36fcb119f1764d9162e5ce42370a3c3c241872a45f5f6ac5b1750` |
| `src/routes/sales.js` | 11,385 | `341d79102fd25ba1af568dae87dd9c636919897ca7b7cf9eefb0c9062279d481` |
| `src/routes/session.js` | 1,076 | `da813a941e5edab1baaf955ace44e0ed266731267236bb653880a937d28157c1` |
| `src/routes/shipments.js` | 5,083 | `63eb7ee0606a58c75888c4f9c11b17f6e84980c1b2e1b6e2baa2cb196f2b689c` |
| `src/routes/stations.js` | 9,687 | `bb312493e8edea7b3574f4acf1d0a6028f647f7a3573d457b84f43416d209ce9` |
| `src/routes/workspace.js` | 33,630 | `118187004b3c489469ce3bcbf8927e90ad0bc16f3554fd247a1babc9570c9e79` |
| `test/auth.integration.mjs` | 17,303 | `5a91ed48d94d7998776ffe8ee028f9ebb1e0583c318975395d5833194dfaef69` |
| `test/auth.test.mjs` | 1,355 | `43fb686cbc7655a9bbdc6eb9f3ee3379e691ccc1cb13e9be6c545a285914dc06` |
| `test/codes.test.mjs` | 1,037 | `cb3c47e6177eddc41b9e1120a58e020180533c7a5cf34ffed0b505ce3587b3f4` |
| `test/finance-integration.test.mjs` | 10,300 | `0a8212866527a0eb3b811d40b736fc21b210cdc7fee164643a62c1367fb4c607` |
| `test/module-definitions.test.mjs` | 1,736 | `78230cbe0015abbb4948b3e4c8aa8fcb2c1cdc6b30f24eec03dfe10a4a436a60` |
| `test/receiving.test.mjs` | 922 | `8d7d8e78695954544602a1ebd518b363b636d6ddfd39f9549d01cff29f217610` |
| `test/specialist-engine.test.mjs` | 10,573 | `010ed72fa1741e891974e89419a6474492c6d6d4a93b8dd62438e3704743f79d` |
| `test/transaction-rules.test.mjs` | 4,410 | `6765d590e3fe858bb416c90d4099052d80d77440a1a816542aaae85450ef3877` |
| `wrangler.toml` | 694 | `9d676674c9c63ab7834898ee3038e48b1623092e811354aa8f100014c3a01fe2` |
