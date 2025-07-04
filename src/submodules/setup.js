"use strict";

const pathlib = require("path");

const { question, tryAccessSync, writeJsonSync, deleteFileSync } = require("../shared/static");
const { fail } = require("../shared/error");
const { Logger } = require("../shared/logger");
const { CONFIG_INFOS } = require("../config");
const { readRuntimeConfig } = require("../context");

const PROCESS_CWD = process.cwd();
const HOME = process.env.HOME || process.env.USERPROFILE;

const LOCATION = Object.freeze({
  LOCAL: "LOCAL",
  GLOBAL: "GLOBAL",
});
const LOCATION_DIR = Object.freeze({
  [LOCATION.LOCAL]: PROCESS_CWD,
  [LOCATION.GLOBAL]: HOME,
});
const FILENAME = Object.freeze({
  CONFIG: ".mtxrc.json",
  CACHE: ".mtxcache.json",
});

const logger = Logger.getInstance();

const _resolveDir = (filename) => {
  let subdirs = PROCESS_CWD.split(pathlib.sep);
  while (true) {
    const dir = subdirs.length === 0 ? HOME : subdirs.join(pathlib.sep);
    const filepath = dir + pathlib.sep + filename;
    if (tryAccessSync(filepath)) {
      return {
        dir,
        filepath,
        location: dir === HOME ? LOCATION.GLOBAL : LOCATION.LOCAL,
      };
    }
    if (subdirs.length === 0) {
      return null;
    }
    subdirs = subdirs.slice(0, -1);
  }
};

const _writeRuntimeConfig = async (runtimeConfig, filepath) => {
  try {
    writeJsonSync(filepath, runtimeConfig);
    logger.info("wrote runtime config");
  } catch (err) {
    fail("caught error while writing runtime config:", err.message);
  }
};

const _setup = async (location) => {
  const dir = LOCATION_DIR[location];
  const filepath = pathlib.join(dir, FILENAME.CONFIG);
  const runtimeConfig = readRuntimeConfig(filepath, { logged: true, checkConfig: false });

  const newRuntimeConfig = {};
  logger.info("hit enter to skip a question. re-using the same app for multiple questions is possible.");
  try {
    const settings = Object.values(CONFIG_INFOS);
    for (let i = 0; i < settings.length; i++) {
      const value = settings[i];
      const ask = `${i + 1}/${settings.length} | ${value.question}`;
      const answer = (await question(ask, runtimeConfig[value.config])).trim();
      if (answer) {
        newRuntimeConfig[value.config] = answer;
      }
    }
  } catch (err) {
    // NOTE: if a ctrl-c interrupt is signaled, question() throws an undefined
    if (err) {
      fail("caught error during question:", err.message);
    } else {
      fail();
    }
  }
  return _writeRuntimeConfig(newRuntimeConfig, filepath);
};

const setup = async () => {
  return _setup(LOCATION.GLOBAL);
};

const setupLocal = async () => {
  return _setup(LOCATION.LOCAL);
};

const setupList = () => {
  const { filepath } = _resolveDir(FILENAME.CONFIG) || {};
  const runtimeConfig = readRuntimeConfig(filepath, { logged: true });
  return Object.values(CONFIG_INFOS)
    .map(
      (value, i, settings) =>
        `${i + 1}/${settings.length} | ${value.question} ${runtimeConfig[value.config] || "<empty>"}`
    )
    .join("\n");
};

const setupCleanCache = () => {
  while (true) {
    const { filepath, location } = _resolveDir(FILENAME.CACHE) || {};
    if (!filepath) {
      break;
    }
    try {
      deleteFileSync(filepath);
      logger.info(`removed ${location.toLowerCase()} cache`, filepath);
    } catch (err) {
      fail(`could not remove ${filepath}`);
    }
  }
};

module.exports = {
  setup,
  setupLocal,
  setupList,
  setupCleanCache,
};
