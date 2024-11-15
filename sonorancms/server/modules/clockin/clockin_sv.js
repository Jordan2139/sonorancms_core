const luaConfig1 = LoadResourceFile(GetCurrentResourceName(), "/config.lua");
const cleanLuaConfig1 = luaConfig1.replace(/--.*/g, "");
const serverConfig = {};
const config = JSON.parse(LoadResourceFile(GetCurrentResourceName(), "/server/modules/clockin/clockin_config.json"));
cleanLuaConfig1.replace(/Config\.(\w+)\s*=\s*(.*?)(?=\n|$)/g, (match, key, value) => {
	serverConfig[key] = value.trim();
});
let apiIdType = serverConfig.apiIdType;

/**
 *
 * @param {string} message
 * @param  {errStack} args
 * @returns
 */
errorLog = (message, ...args) => {
	return console.log(`^1[ERROR - Sonoran CMS ClockIn - ${new Date().toLocaleString()}] ${message}`, args + "^0");
};

/**
 *
 * @param {string} message
 * @returns
 */
infoLog = (message) => {
	return console.log(`[INFO - Sonoran CMS ClockIn - ${new Date().toLocaleString()}] ${message}`);
};

/**
 *
 * @param {string} apiId
 * @param {boolean} forceClockIn
 * @returns {Promise}
 */
const clockPlayerIn = (apiId, forceClockIn) => {
	return new Promise(async (resolve, reject) => {
		exports.sonorancms.performApiRequest([{ apiId: apiId, forceClockIn: !!forceClockIn }], "CLOCK_IN_OUT", function (res) {
			res = JSON.parse(res);
			if (res) {
				resolve(res.completed);
			} else {
				reject("There was an error");
			}
		});
	});
};

/**
 * @param {string} accID
 * @param {boolean} forceClockIn
 * @returns {Promise}
 */
const clockPlayerInFromCad = (accID, forceClockIn) => {
	return new Promise(async (resolve, reject) => {
		exports.sonorancms.performApiRequest([{ accId: accID, forceClockIn: !!forceClockIn }], "CLOCK_IN_OUT", function (res) {
			res = JSON.parse(res);
			if (res) {
				resolve(res.completed);
			} else {
				reject("There was an error");
			}
		});
	});
};

async function initialize() {
	await exports.sonorancms.sleep(2000);
	if (config) {
		global.exports("clockPlayerIn", async (source, forceClockIn = false) => {
			const apiId = await exports.sonorancms.getAppropriateIdentifier(source, apiIdType);
			await clockPlayerIn(apiId, forceClockIn)
				.then((inOrOut) => {
					return { success: true, in: inOrOut };
				})
				.catch((err) => {
					return { success: false, err };
				});
		});
		if (config.enableCommand) {
			RegisterCommand(
				config.command || "clockin",
				async (source) => {
					const apiId = await exports.sonorancms.getAppropriateIdentifier(source, apiIdType);
					emit('SonoranCMS::core:writeLog', 'debug', `Triggering clockPlayerIn for ${apiId} based on command...`)
					await clockPlayerIn(apiId, false)
						.then((inOrOut) => {
							emit('SonoranCMS::core:writeLog', 'debug', `Clocked player ${GetPlayerName(source)} (${apiId}) ${inOrOut ? "out" : "in"}!`)
							if (inOrOut == false) {
								emitNet("chat:addMessage", source, {
									color: [255, 0, 0],
									multiline: false,
									args: [`^3^*Sonoran CMS:^7 Successfully clocked in!`],
								});
							} else if (inOrOut == true) {
								emitNet("chat:addMessage", source, {
									color: [255, 0, 0],
									multiline: false,
									args: [`^3^*Sonoran CMS:^7 Successfully clocked out!`],
								});
							} else {
								emitNet("chat:addMessage", source, {
									color: [255, 0, 0],
									multiline: false,
									args: [`^8^*Sonoran CMS:^7 You do not have permissions to use this command...`],
								});
								errorLog(`${GetPlayerName(source)} (${apiId}) did not have perms to clock in...`);
							}
						})
						.catch((err) => {
							emitNet("chat:addMessage", source, {
								color: [255, 0, 0],
								multiline: false,
								args: [`^8^*Sonoran CMS:^7 ${err || "An error occured while clocking in..."}`],
							});
							errorLog(`An error occured while clocking in ${GetPlayerName(source)} (${apiId})... ${err}`);
						});
				},
				config.useAcePermissions
			);
			if (config?.esx?.use) {
				onNet("esx_service:activateService", async () => {
					const apiId = exports.sonorancms.getAppropriateIdentifier(source, apiIdType);
					emit('SonoranCMS::core:writeLog', 'debug', `Triggering clockPlayerIn for ${apiId} based on esx_service:activateService event...`)
					await clockPlayerIn(apiId, forceClockIn)
						.then((inOrOut) => {
							emit('SonoranCMS::core:writeLog', 'debug', `Clocked player ${GetPlayerName(src)} (${apiId}) ${inOrOut ? "out" : "in"}!`)
							emitNet("chat:addMessage", source, {
								color: [255, 0, 0],
								multiline: false,
								args: [`^3^*Sonoran CMS:^7 Successfully clocked ${inOrOut ? "out" : "in"}!`],
							});
							return { success: true, in: inOrOut };
						})
						.catch((err) => {
							return { success: false, err };
						});
				});
			}
			onNet("SonoranCMS::ClockIn::Server::ClockPlayerIn", async (forceClockIn) => {
				const src = global.source;
				const apiId = await exports.sonorancms.getAppropriateIdentifier(src, apiIdType);
				emit('SonoranCMS::core:writeLog', 'debug', `Triggering clockPlayerIn for ${apiId} based on SonoranCMS::ClockIn::Server::ClockPlayerIn event...`)
				await clockPlayerIn(apiId, forceClockIn)
					.then((inOrOut) => {
					emit('SonoranCMS::core:writeLog', 'debug', `Clocked player ${accID.accId} ${inOrOut ? "out" : "in"}!`)
					})
					.catch((err) => {
						errorLog(`Failed to clock player ${GetPlayerName(src)} (${apiId}) ${inOrOut ? "out" : "in"}...`);
					});
			});
		}
		if (config?.cad?.use) {
			if (GetResourceState("sonorancad") !== "started") {
				errorLog(`[SonoranCMS ClockIn] SonoranCAD resource is in a bad state (${GetResourceState("sonorancad")})... please ensure it is started or disable the CAD integration in the config...`);
				return
			}
			onNet("SonoranCAD::pushevents:UnitLogin", async (accID) => {
				if (!accID?.accId) {
					errorLog("No accId found in UnitLogin event... ignoring...");
					return
				}
				emit('SonoranCMS::core:writeLog', 'debug', `Triggering clockPlayerInFromCad for ${accID.accId} based on UnitLogin event...`)
				await clockPlayerInFromCad(accID.accId, true)
					.then((inOrOut) => {
						emit('SonoranCMS::core:writeLog', 'debug', `Clocked player ${accID.accId} ${inOrOut ? "out" : "in"}!`)
					})
					.catch((err) => {
						errorLog(`Failed to clock player ${accID.accId} ${inOrOut ? "out" : "in"}...`);
				});
			})
			onNet("SonoranCAD::pushevents:UnitLogout", async (accID) => {
				if (!accID?.accId) {
					errorLog("No accId found in UnitLogin event... ignoring...");
					return
				}
				let unitId = exports.sonorancad.GetUnitById(accID);
				let unitCache = exports.sonorancad.GetUnitCache();
				let foundUnit = unitCache[unitId - 1];
				emit('SonoranCMS::core:writeLog', 'debug', `Triggering clockPlayerInFromCad for ${foundUnit.accId} based on UnitLogout event...`)
				await clockPlayerInFromCad(foundUnit.accId, false)
					.then((inOrOut) => {
					})
					.catch((err) => {
						errorLog(`Failed to clock player ${foundUnit.accId} ${inOrOut ? "out" : "in"}...`);
					});
			});
		}
	} else {
		errorLog("No config found... looked for clockin_config.json & server convars...");
	}
}

initialize();
