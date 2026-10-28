# Changelog

## 0.1.0 (2026-10-28)


### ⚠ BREAKING CHANGES

* the project licence changes from Apache-2.0 to MIT.
* **release:** the release folder no longer contains setup, update, backup and restore scripts; an installation updates with docker compose pull and docker compose up -d.
* **compose:** the stack no longer reads STUDIOFLOW_DOMAIN, STUDIOFLOW_NODE_IP, STUDIOFLOW_TLS_MODE, the DNS credentials or the BACKUP_* schedule from .env. An existing installation keeps its database and LiveKit key pair (the init service adopts POSTGRES_PASSWORD, LIVEKIT_API_KEY and LIVEKIT_API_SECRET from the old .env on its first start) and enters the address, the certificate and the schedule again in the Regie (docs/runbook.md, "Moving from the script installation").

### Features

* **api:** add audio sources and the audio mixer state ([af37f74](https://github.com/OPTEN/StudioFlow/commit/af37f74c3a64ee90ce240410bdcd996f2d7ed9b3)), closes [#7](https://github.com/OPTEN/StudioFlow/issues/7)
* **api:** add text sources and the production text colours ([d59adbd](https://github.com/OPTEN/StudioFlow/commit/d59adbd31b1f6be7e82a07c4e4ab533c93ca5850)), closes [#13](https://github.com/OPTEN/StudioFlow/issues/13)
* **api:** add the camera control command and the camera report of a phone ([ad2e186](https://github.com/OPTEN/StudioFlow/commit/ad2e1866cea3cc40ba64a42e4aaa2d728fd8aa72)), closes [#11](https://github.com/OPTEN/StudioFlow/issues/11)
* **api:** add the scene item order endpoint ([677c5a3](https://github.com/OPTEN/StudioFlow/commit/677c5a348eabb8703f014a3fd688f6ffae0ef55b)), closes [#19](https://github.com/OPTEN/StudioFlow/issues/19)
* **api:** audit the lens switch of a phone camera, test the audit log API ([876d906](https://github.com/OPTEN/StudioFlow/commit/876d90627bd1e6dd5ab686723fed26f3551554d3)), closes [#17](https://github.com/OPTEN/StudioFlow/issues/17)
* **api:** carry encoder facts and the load of the output page in the reports ([28f5e9b](https://github.com/OPTEN/StudioFlow/commit/28f5e9ba214c18e7990527f0f0715746abf15620)), closes [#12](https://github.com/OPTEN/StudioFlow/issues/12)
* **api:** carry the sound of videos through duplicate, export and import ([f8d721a](https://github.com/OPTEN/StudioFlow/commit/f8d721a75c8e3b9de7ce037e0f19c77d08cabce8))
* **api:** duplicate, export and import a production with devices as placeholders ([2f71caf](https://github.com/OPTEN/StudioFlow/commit/2f71caf4294d66e0d7b9af629cf81cf1795f038d)), closes [#14](https://github.com/OPTEN/StudioFlow/issues/14)
* **api:** give the text actions an audit category ([921e9e2](https://github.com/OPTEN/StudioFlow/commit/921e9e2b84e102e0c757a1c22e0c8cb5d0f51a44)), closes [#17](https://github.com/OPTEN/StudioFlow/issues/17)
* **api:** let the certificate upload name the domain it has to cover ([0c3f2f8](https://github.com/OPTEN/StudioFlow/commit/0c3f2f8902452d4128110ab77c13332e82cbc781)), closes [#27](https://github.com/OPTEN/StudioFlow/issues/27)
* **api:** make format and resolution of the output canvas selectable ([3a5b4cd](https://github.com/OPTEN/StudioFlow/commit/3a5b4cdcafe05397e7bc96a6ff6e15e7384c40bc)), closes [#8](https://github.com/OPTEN/StudioFlow/issues/8)
* **api:** query and export the audit log, with retention ([c7c8497](https://github.com/OPTEN/StudioFlow/commit/c7c849701c81ab2b8ea3c657eb690cc01d9ed54c)), closes [#17](https://github.com/OPTEN/StudioFlow/issues/17)
* **api:** record the missing audit events and give every action a category and a text ([401f95d](https://github.com/OPTEN/StudioFlow/commit/401f95de7d08a99b12b3250c0f994a8d34e74f2e)), closes [#17](https://github.com/OPTEN/StudioFlow/issues/17)
* **api:** regenerate the contracts for text sources ([f087305](https://github.com/OPTEN/StudioFlow/commit/f08730578b76d079b743be18cb19bd9101d1ec35)), closes [#13](https://github.com/OPTEN/StudioFlow/issues/13)
* **api:** replace the single output key by named output links ([b5d2218](https://github.com/OPTEN/StudioFlow/commit/b5d22180de7c5b30afb0cc21a5455471576bfb74)), closes [#9](https://github.com/OPTEN/StudioFlow/issues/9)
* **api:** report one version with the commit it was built from ([9071db5](https://github.com/OPTEN/StudioFlow/commit/9071db5382f4bfc45eedf9fdf574a29862753e0c))
* **api:** server settings for the first-run wizard and the settings page ([c8c1e74](https://github.com/OPTEN/StudioFlow/commit/c8c1e74a0a3495adb439f679f1cdb52d566f4cfd)), closes [#27](https://github.com/OPTEN/StudioFlow/issues/27)
* **api:** show the canvas change in the audit log ([9c629b9](https://github.com/OPTEN/StudioFlow/commit/9c629b92fee092277f28b4d60382f20df87ef5eb)), closes [#8](https://github.com/OPTEN/StudioFlow/issues/8)
* **auth:** create the Regie account in a first-run setup ([967ccbd](https://github.com/OPTEN/StudioFlow/commit/967ccbd444e245557dc7a4212856f755e8eb3d8b)), closes [#4](https://github.com/OPTEN/StudioFlow/issues/4)
* **backup:** run backups and restores as commands of the backup image ([3de50c4](https://github.com/OPTEN/StudioFlow/commit/3de50c4831fb7f13c394248365510bc38701f337)), closes [#27](https://github.com/OPTEN/StudioFlow/issues/27)
* **brand:** adopt the "Programm" logo ([4caa1f8](https://github.com/OPTEN/StudioFlow/commit/4caa1f8aa86f2171d41de751fec2ff26f25f82e6)), closes [#62](https://github.com/OPTEN/StudioFlow/issues/62)
* build the clickable prototype as one offline file and ship it with every release ([73e3ecf](https://github.com/OPTEN/StudioFlow/commit/73e3ecf9ffa50ffaed294aed4227e81f4110844d)), closes [#5](https://github.com/OPTEN/StudioFlow/issues/5)
* **caddy:** follow the certificate for the HSTS duration unless the operator sets one ([c702b45](https://github.com/OPTEN/StudioFlow/commit/c702b45444d3c2c1e97163854df9f4184c0ad2b6)), closes [#27](https://github.com/OPTEN/StudioFlow/issues/27)
* **caddy:** take the site configuration from the API ([a037a9c](https://github.com/OPTEN/StudioFlow/commit/a037a9cf4ce6084952cd2dfd974fd2307222da44)), closes [#27](https://github.com/OPTEN/StudioFlow/issues/27)
* **compose:** start with docker compose up and no host scripts ([64affd9](https://github.com/OPTEN/StudioFlow/commit/64affd9a28b00102dcdcade716d56f228fc70592)), closes [#27](https://github.com/OPTEN/StudioFlow/issues/27)
* Enhance E2E tests with English texts and i18n support ([#28](https://github.com/OPTEN/StudioFlow/issues/28)) ([a0ed310](https://github.com/OPTEN/StudioFlow/commit/a0ed310c4ef1ca1d785db69df90964669fddafc7))
* **infra:** route the import of a production through Caddy with its own limit ([cdfb5ec](https://github.com/OPTEN/StudioFlow/commit/cdfb5ecfd7aac92725faa9d3557031f3e71bb2f8)), closes [#14](https://github.com/OPTEN/StudioFlow/issues/14)
* **livekit:** add a wrapper image that follows livekit.yaml ([54bd54e](https://github.com/OPTEN/StudioFlow/commit/54bd54e030a6b8d72768343f798c006fc0c1f5ff)), closes [#27](https://github.com/OPTEN/StudioFlow/issues/27)
* **media-client:** add a WebRTC round trip for the media address test ([88dc3e7](https://github.com/OPTEN/StudioFlow/commit/88dc3e73db31e14264fc64e63c60660b6a7288ad)), closes [#27](https://github.com/OPTEN/StudioFlow/issues/27)
* **media-client:** control the phone camera remotely ([a1597b5](https://github.com/OPTEN/StudioFlow/commit/a1597b5806c16ee6986dd6b691f4130be049d5e7)), closes [#11](https://github.com/OPTEN/StudioFlow/issues/11)
* **media-client:** publish microphone and screen audio, receive and mix audio tracks ([5302807](https://github.com/OPTEN/StudioFlow/commit/5302807133aff0a84e4f02962ccbe3d1d4413018)), closes [#7](https://github.com/OPTEN/StudioFlow/issues/7)
* **ops:** run setup and update with ready-made images ([7e5ab3e](https://github.com/OPTEN/StudioFlow/commit/7e5ab3e5327494c220d2e4e84a21f2bfe5849bae))
* **output:** draw the stage at the canvas of the production ([013e988](https://github.com/OPTEN/StudioFlow/commit/013e98840c790b191c05052d72b79d28460699a5)), closes [#8](https://github.com/OPTEN/StudioFlow/issues/8)
* **output:** play the sound of the program with Web Audio ([22b106b](https://github.com/OPTEN/StudioFlow/commit/22b106b22e36b5533b3da75e1e07dc3e7bc42646)), closes [#7](https://github.com/OPTEN/StudioFlow/issues/7)
* **regie:** add a light theme with a Dark | Light | System setting ([b93deff](https://github.com/OPTEN/StudioFlow/commit/b93deff84866a815a70da4b57b444ed62369a483)), closes [#10](https://github.com/OPTEN/StudioFlow/issues/10)
* **regie:** add texts and lower thirds to the Sources dock, the Properties dock and the production menu ([e4f79be](https://github.com/OPTEN/StudioFlow/commit/e4f79bec02b69bb40d3927d8c811b3f40ae5fd3d)), closes [#13](https://github.com/OPTEN/StudioFlow/issues/13)
* **regie:** add the audit log page ([5d809b8](https://github.com/OPTEN/StudioFlow/commit/5d809b8947602f3603839680f1cac0cc1909dbaa)), closes [#17](https://github.com/OPTEN/StudioFlow/issues/17)
* **regie:** add the camera control panel to the Stations dock ([ae8a20a](https://github.com/OPTEN/StudioFlow/commit/ae8a20a1a24958223e4a7e147689ecde48a7487c)), closes [#11](https://github.com/OPTEN/StudioFlow/issues/11)
* **regie:** add the first-run setup page and the password change ([2b95c19](https://github.com/OPTEN/StudioFlow/commit/2b95c192efc3a5d32fb1d2b3800983143f6951e4)), closes [#4](https://github.com/OPTEN/StudioFlow/issues/4)
* **regie:** choose the format and resolution and draw everything in its shape ([1e9cd28](https://github.com/OPTEN/StudioFlow/commit/1e9cd286cfd23c477ec2fee748f958ed362db1b2)), closes [#8](https://github.com/OPTEN/StudioFlow/issues/8)
* **regie:** duplicate, export and import in the production menu, placeholders in the docks ([b5b598d](https://github.com/OPTEN/StudioFlow/commit/b5b598dead98248c4409990229efb7a1c447ccae)), closes [#14](https://github.com/OPTEN/StudioFlow/issues/14)
* **regie:** make the OBS scene collection follow the format; document format and resolution ([6e21c6d](https://github.com/OPTEN/StudioFlow/commit/6e21c6de34162ade6ad46254ab09cac04286764d)), closes [#8](https://github.com/OPTEN/StudioFlow/issues/8)
* **regie:** manage named output links and use a link as a camera ([4945d8b](https://github.com/OPTEN/StudioFlow/commit/4945d8b5e7e5bea308af559379835067fe792d85)), closes [#9](https://github.com/OPTEN/StudioFlow/issues/9)
* **regie:** name the connected output links in the chip and keep the popover open on download ([4f78f30](https://github.com/OPTEN/StudioFlow/commit/4f78f304beb65b08e9c89067fe437b713ec3acd6)), closes [#9](https://github.com/OPTEN/StudioFlow/issues/9)
* **regie:** placeholders, duplicate, export and import in the client foundation ([7a41f15](https://github.com/OPTEN/StudioFlow/commit/7a41f150dc230fc4c86afe5ff366cfd1db1b80d7)), closes [#14](https://github.com/OPTEN/StudioFlow/issues/14)
* **regie:** reorder sources and scenes by drag and drop ([171a851](https://github.com/OPTEN/StudioFlow/commit/171a851501b3e378992cb168b515486e5e152537)), closes [#19](https://github.com/OPTEN/StudioFlow/issues/19)
* **regie:** show the running version in the settings menu and the output debug overlay ([0613b8c](https://github.com/OPTEN/StudioFlow/commit/0613b8ca68d4ab4895665409d1af35bae521cae4)), closes [#18](https://github.com/OPTEN/StudioFlow/issues/18)
* **release:** add the release Compose file, the release files and the release-please configuration ([dcc277a](https://github.com/OPTEN/StudioFlow/commit/dcc277affe7f08a01203161ec5030bf1a183b246))
* **scene-model:** add the audio mixer state, the audibility rule and its selectors ([1a46158](https://github.com/OPTEN/StudioFlow/commit/1a46158febd6ca139d56efbdc73882159778b368)), closes [#7](https://github.com/OPTEN/StudioFlow/issues/7)
* **scene-model:** derive geometry, templates and defaults from the canvas ([10e8da0](https://github.com/OPTEN/StudioFlow/commit/10e8da0978d9f52563cf0357780be300de780de5)), closes [#8](https://github.com/OPTEN/StudioFlow/issues/8)
* **scene-model:** model texts: source references, defaults, contrast and log messages ([470f81b](https://github.com/OPTEN/StudioFlow/commit/470f81be23d97616534e6a421f1d2a9930c4e344)), closes [#13](https://github.com/OPTEN/StudioFlow/issues/13)
* **scene-model:** share the audio ramp rule and add the silence tracker ([375a074](https://github.com/OPTEN/StudioFlow/commit/375a0748b8066ac96ba5230d1eb274ee0caa7f9f)), closes [#7](https://github.com/OPTEN/StudioFlow/issues/7)
* **scene-renderer:** draw texts as HTML with an animated show and hide ([bb5fb39](https://github.com/OPTEN/StudioFlow/commit/bb5fb3913f874b499ac7d73b50480fb220be62a1)), closes [#13](https://github.com/OPTEN/StudioFlow/issues/13)
* **scene-renderer:** render at the canvas of the production ([a6b41ba](https://github.com/OPTEN/StudioFlow/commit/a6b41ba132da969e39e314fa7ab4f4570e7ec575)), closes [#8](https://github.com/OPTEN/StudioFlow/issues/8)
* **scene-renderer:** tell the provider which element plays a video asset ([266a0fa](https://github.com/OPTEN/StudioFlow/commit/266a0fa3fbf85426fb8a87bdf68e4be82448bcea)), closes [#7](https://github.com/OPTEN/StudioFlow/issues/7)
* **sender:** add "Video in screen" for screens that play a video ([3a7b707](https://github.com/OPTEN/StudioFlow/commit/3a7b707c8d180d80490252ae4e1acfbb0efe236e)), closes [#12](https://github.com/OPTEN/StudioFlow/issues/12)
* **sender:** apply remote camera control and report the camera of a phone ([714a2ef](https://github.com/OPTEN/StudioFlow/commit/714a2ef28b347f3ea6c7cc475685cc986c224f09)), closes [#11](https://github.com/OPTEN/StudioFlow/issues/11)
* **sender:** send the microphone, the audio station and the sound of a screen ([8b25cae](https://github.com/OPTEN/StudioFlow/commit/8b25cae60aff6d7b4044e6ddd0150d41b1ef2c67)), closes [#7](https://github.com/OPTEN/StudioFlow/issues/7)
* **setup:** leave the Regie account to the first-run setup ([41aa715](https://github.com/OPTEN/StudioFlow/commit/41aa71572cf392ed9f83b6b844744cab09e459f4)), closes [#4](https://github.com/OPTEN/StudioFlow/issues/4)
* **site:** commit the product video and stop rendering it in Pages ([#76](https://github.com/OPTEN/StudioFlow/issues/76)) ([7f89010](https://github.com/OPTEN/StudioFlow/commit/7f89010afe45195a744e8d5a989148a609a5f969))
* **studio:** add the Audio dock, the program level and monitoring ([8a5055c](https://github.com/OPTEN/StudioFlow/commit/8a5055cdd69fc2a239ee5e19c03349fc796c5c45)), closes [#7](https://github.com/OPTEN/StudioFlow/issues/7)
* **studio:** add the first-run wizard and the server settings page ([aa0cce9](https://github.com/OPTEN/StudioFlow/commit/aa0cce95ac073428e241105558adac9ecbe809d9)), closes [#27](https://github.com/OPTEN/StudioFlow/issues/27)
* **studio:** show "Sponsored by OPTEN" in the header ([dc75231](https://github.com/OPTEN/StudioFlow/commit/dc75231f4a36c7707675874ce8beb7e73fbabc78)), closes [#61](https://github.com/OPTEN/StudioFlow/issues/61)
* **studio:** show CPU limit, encoding, decoding and the load of the output ([8f3ef30](https://github.com/OPTEN/StudioFlow/commit/8f3ef305b3d5119c42fe2e7d120a60c9c8e333be)), closes [#12](https://github.com/OPTEN/StudioFlow/issues/12)


### Bug Fixes

* **api:** count the dropped share of the output page in points ([afcb05c](https://github.com/OPTEN/StudioFlow/commit/afcb05c806c11539be4d3526603f4dea6b22a263)), closes [#12](https://github.com/OPTEN/StudioFlow/issues/12)
* **api:** do not cap the number of productions ([50b74a5](https://github.com/OPTEN/StudioFlow/commit/50b74a5956143bfd0795d1191ff33b04a3f9df97)), closes [#14](https://github.com/OPTEN/StudioFlow/issues/14)
* **api:** hand clients the LiveKit URL of the address they used ([58c4143](https://github.com/OPTEN/StudioFlow/commit/58c4143d7e7f097925cb343dfaf355ef2ab50221)), closes [#44](https://github.com/OPTEN/StudioFlow/issues/44) [#27](https://github.com/OPTEN/StudioFlow/issues/27)
* **api:** harden the TLS key mode, the login audit, the session lifetime and the password hash ([027bbd1](https://github.com/OPTEN/StudioFlow/commit/027bbd1043baa283e113b8389bd3ceb36e94fc47)), closes [#71](https://github.com/OPTEN/StudioFlow/issues/71)
* **api:** let the server settings decide the address of every link ([9072a69](https://github.com/OPTEN/StudioFlow/commit/9072a6953951d4f63f446dbbcb90742ef81d4869)), closes [#27](https://github.com/OPTEN/StudioFlow/issues/27)
* **api:** publish the decoder counts of the output with the interval, not at once ([2d8bca0](https://github.com/OPTEN/StudioFlow/commit/2d8bca0bfa99d862246b24e491189ff54c6875d2)), closes [#12](https://github.com/OPTEN/StudioFlow/issues/12)
* **api:** publish the dropped share of the output when it crosses the warning point ([52a32e5](https://github.com/OPTEN/StudioFlow/commit/52a32e515c04d6531393843c7e0f3cd6c59a8f6c)), closes [#12](https://github.com/OPTEN/StudioFlow/issues/12)
* **api:** read the database password from the secrets volume in the operator commands ([06332f5](https://github.com/OPTEN/StudioFlow/commit/06332f5559b2e6cc2e597d763006ab5adb6639da)), closes [#73](https://github.com/OPTEN/StudioFlow/issues/73)
* **api:** regenerate the output links migration on top of the texts migration ([3e019ee](https://github.com/OPTEN/StudioFlow/commit/3e019ee1a2a2da3dc338c05cc19453023798c156)), closes [#9](https://github.com/OPTEN/StudioFlow/issues/9)
* **api:** say "file too large" when a streamed import crosses the body limit ([85ecade](https://github.com/OPTEN/StudioFlow/commit/85ecade6a33692cabb8aa3be8950d834bf229d0c)), closes [#14](https://github.com/OPTEN/StudioFlow/issues/14)
* **api:** switch GSS encryption off in the database connection ([4f4eb7a](https://github.com/OPTEN/StudioFlow/commit/4f4eb7abb0f2de64ecd189cf89529c668479ab1c)), closes [#33](https://github.com/OPTEN/StudioFlow/issues/33)
* **api:** take the scheme of the LiveKit URL from the base URL, not from the request ([df70d36](https://github.com/OPTEN/StudioFlow/commit/df70d368cdb3f7e146537611784c7d7df4b25a3c)), closes [#27](https://github.com/OPTEN/StudioFlow/issues/27) [#44](https://github.com/OPTEN/StudioFlow/issues/44)
* **ci:** cache the sample media of the E2E harness and install ffmpeg only on a miss ([8987a8f](https://github.com/OPTEN/StudioFlow/commit/8987a8fe61731475d97b8d9a796415cb3c419400)), closes [#58](https://github.com/OPTEN/StudioFlow/issues/58)
* **ci:** generate platform-independent OpenAPI text and make stack.sh executable ([b09d8bf](https://github.com/OPTEN/StudioFlow/commit/b09d8bf21428e529efeab5aac33b0226fa8e4ffe))
* **ci:** let the sample media checks run with cached samples and no ffmpeg ([bd1da4a](https://github.com/OPTEN/StudioFlow/commit/bd1da4a832639525da786359c16a11bf8c26eb44)), closes [#58](https://github.com/OPTEN/StudioFlow/issues/58)
* **ci:** report a failed full E2E run in the ci-failure issue ([6f57aab](https://github.com/OPTEN/StudioFlow/commit/6f57aab531f7c8b7ca26a53c2d0ebf737b462bae)), closes [#52](https://github.com/OPTEN/StudioFlow/issues/52)
* **infra:** take the Alpine fixes and golang.org/x/net v0.61.0 into the Caddy image ([bac8ae1](https://github.com/OPTEN/StudioFlow/commit/bac8ae13a8e62007e10cd7c76615d54f5d41443a)), closes [#47](https://github.com/OPTEN/StudioFlow/issues/47)
* **media-client:** keep the normal grace time for tracks that arrive while the page loads ([6b554e8](https://github.com/OPTEN/StudioFlow/commit/6b554e8353e95391ed87b2073ccaa0a5428a81e1)), closes [#12](https://github.com/OPTEN/StudioFlow/issues/12)
* **ops:** pass the release scan and start the versions at 0.1.0 ([7458396](https://github.com/OPTEN/StudioFlow/commit/7458396758ed0fd7b0c44d7deefe4f753873e99d))
* **ops:** take the Caddy admin API off the network and split the networks by need ([d83223d](https://github.com/OPTEN/StudioFlow/commit/d83223dfd6d91d891b8979024f5c46cd31f31bcb)), closes [#70](https://github.com/OPTEN/StudioFlow/issues/70)
* **output:** put the "Sound on" button into the page only while it is needed ([d71dbe9](https://github.com/OPTEN/StudioFlow/commit/d71dbe907a4d982c27e6aad1fe4f86054cbf4bb8)), closes [#7](https://github.com/OPTEN/StudioFlow/issues/7)
* **pages:** let the build job read the Pages settings ([6f09699](https://github.com/OPTEN/StudioFlow/commit/6f09699f14e7e770573b7d6e02a0f5674a19d4a9))
* **regie:** click the OBS download link inside the popover and name the add button "Create link" ([0599683](https://github.com/OPTEN/StudioFlow/commit/05996839560b0f7bcc48f771909895c53d5f62ee)), closes [#9](https://github.com/OPTEN/StudioFlow/issues/9)
* **regie:** follow the theme in the browser chrome colour ([e9b5a1b](https://github.com/OPTEN/StudioFlow/commit/e9b5a1be9dac093acb20ecfc77ad8c1a96db7f23))
* **regie:** meet WCAG contrast for the PGM tag, Take hint, red text and field edges ([0ae0c2b](https://github.com/OPTEN/StudioFlow/commit/0ae0c2b132594399e4b7441dccdac0882c8aed40))
* **regie:** name the new source without a code in the assignment toast, tidy the offer strip ([4abf2ff](https://github.com/OPTEN/StudioFlow/commit/4abf2ffe1c2d68d1683bd43dbe0ab6878a118b30)), closes [#14](https://github.com/OPTEN/StudioFlow/issues/14)
* **regie:** never take the page element as the scroller of a sortable list ([fa629e1](https://github.com/OPTEN/StudioFlow/commit/fa629e1f890abca03cde50f0df7bb217112a7b08)), closes [#42](https://github.com/OPTEN/StudioFlow/issues/42)
* **regie:** wait for the list of productions before "Last broadcast" picks the active one ([c09a2ab](https://github.com/OPTEN/StudioFlow/commit/c09a2ab61c133158247609785a06a84e35d3192b)), closes [#32](https://github.com/OPTEN/StudioFlow/issues/32)
* **regie:** write the stage layout one frame after the ResizeObserver measured it ([479c1bb](https://github.com/OPTEN/StudioFlow/commit/479c1bb39d0751be10eb41e618255d5cf0a9806d)), closes [#43](https://github.com/OPTEN/StudioFlow/issues/43)
* **renderer:** leave a fade that is only late to finish by itself ([a12784e](https://github.com/OPTEN/StudioFlow/commit/a12784e2f1af0f39eecedb45cf254aa812675e23)), closes [#31](https://github.com/OPTEN/StudioFlow/issues/31)
* **renderer:** let the clock of a fade stand still for a second before it counts as stalled ([4f0dd8f](https://github.com/OPTEN/StudioFlow/commit/4f0dd8fa4c3a818bd21818c0cd834df83c8ea854)), closes [#31](https://github.com/OPTEN/StudioFlow/issues/31)
* **scene-renderer:** look at a frame in a scratch canvas before it replaces the hold frame ([e920dbc](https://github.com/OPTEN/StudioFlow/commit/e920dbc5161ad8ce9fbdebca80c5a47308e7be82)), closes [#50](https://github.com/OPTEN/StudioFlow/issues/50) [#12](https://github.com/OPTEN/StudioFlow/issues/12)
* **scene-renderer:** never keep an empty or black picture as the hold frame ([208e165](https://github.com/OPTEN/StudioFlow/commit/208e165ede3578aa1c5740b0bb3f4b8a9cd9ee2e)), closes [#50](https://github.com/OPTEN/StudioFlow/issues/50) [#12](https://github.com/OPTEN/StudioFlow/issues/12)
* **sender:** allocate further screens one after the other ([3b2c0ff](https://github.com/OPTEN/StudioFlow/commit/3b2c0ffe22f3570cdb53808f3509592db795a894)), closes [#37](https://github.com/OPTEN/StudioFlow/issues/37)
* **studio:** do not request /api/settings before the login ([62aaa17](https://github.com/OPTEN/StudioFlow/commit/62aaa172f8e66911457568003654d9af3d156865)), closes [#63](https://github.com/OPTEN/StudioFlow/issues/63)
* **studio:** focus the password field after a failed login ([47df3fe](https://github.com/OPTEN/StudioFlow/commit/47df3feca9ba2fc28d11e1c11e19d591de35b132)), closes [#66](https://github.com/OPTEN/StudioFlow/issues/66)
* **studio:** give the Audio dock a wider default and a stable test id ([e37a53e](https://github.com/OPTEN/StudioFlow/commit/e37a53e2b4b4dabd4688b5a895d1f9732df5379f)), closes [#7](https://github.com/OPTEN/StudioFlow/issues/7)
* **studio:** keep "Add scene" inside the head of a narrow Scenes dock ([85a7d3e](https://github.com/OPTEN/StudioFlow/commit/85a7d3ed4c131bba04a34ffd83472c9b67b72f16)), closes [#7](https://github.com/OPTEN/StudioFlow/issues/7)
* **studio:** keep the empty state of the Audio dock out of its list ([9c61933](https://github.com/OPTEN/StudioFlow/commit/9c61933869224b9a8d9604f046314ec766c107a5)), closes [#7](https://github.com/OPTEN/StudioFlow/issues/7)
* **studio:** keep the switch guard until the hub event, show a refused switch ([aa116d5](https://github.com/OPTEN/StudioFlow/commit/aa116d5441249d036a734bee51dfa371499c78bd)), closes [#55](https://github.com/OPTEN/StudioFlow/issues/55)
* **studio:** let the Audio dock step aside while the pairing dock is open ([00e9a66](https://github.com/OPTEN/StudioFlow/commit/00e9a66c84ee687e6ffda5292f40085595968a99)), closes [#7](https://github.com/OPTEN/StudioFlow/issues/7)
* **studio:** name the sponsor link by its visible text ([#79](https://github.com/OPTEN/StudioFlow/issues/79)) ([a2620a1](https://github.com/OPTEN/StudioFlow/commit/a2620a1556930faffde6e641c2e34b83d78b19ea))
* **video:** create the audio work folder before the music step ([#75](https://github.com/OPTEN/StudioFlow/issues/75)) ([e1becdf](https://github.com/OPTEN/StudioFlow/commit/e1becdfa391b9e5d430cd54cabb6c42ebd9b757e))


### Performance Improvements

* **media-client:** choose the screen codec by capability and pause sources nobody needs ([cfd2108](https://github.com/OPTEN/StudioFlow/commit/cfd21089d67a6b914999e18bcaf811a274b69594)), closes [#12](https://github.com/OPTEN/StudioFlow/issues/12)
* **output:** create the audio mix after the first frame ([fa395c9](https://github.com/OPTEN/StudioFlow/commit/fa395c9245fa4c8c472e3d6862c0121039d948ac)), closes [#7](https://github.com/OPTEN/StudioFlow/issues/7)
* **output:** prepare the preview scene only and report the load ([4860718](https://github.com/OPTEN/StudioFlow/commit/4860718fd9c982f4bcd5dd2e6301324ee76833b0)), closes [#12](https://github.com/OPTEN/StudioFlow/issues/12)
* **scene-renderer:** show the thumbnail stills as images, not canvases ([472fcb3](https://github.com/OPTEN/StudioFlow/commit/472fcb3845cb3a9d4c0a2f7960356b9c95ca6b1c)), closes [#12](https://github.com/OPTEN/StudioFlow/issues/12)
* **scene-renderer:** stills for thumbnails, visibility, size cap, frame counting and a copy budget ([ef5ff08](https://github.com/OPTEN/StudioFlow/commit/ef5ff08b4aa664ea708b9aea896b0bbd879821fb)), closes [#12](https://github.com/OPTEN/StudioFlow/issues/12)


### Miscellaneous Chores

* publish StudioFlow under the MIT License instead of Apache-2.0 ([35b4712](https://github.com/OPTEN/StudioFlow/commit/35b4712056535f515d6c25e2c1f0350c9681fcfc)), closes [#59](https://github.com/OPTEN/StudioFlow/issues/59)


### Build System

* **release:** ship four images and a bundle without scripts ([755ec7f](https://github.com/OPTEN/StudioFlow/commit/755ec7f37fcca6539f6db01afb26872c6c20e131)), closes [#27](https://github.com/OPTEN/StudioFlow/issues/27)
