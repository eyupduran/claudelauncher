'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const CONFIG_FILE = path.join(ROOT, 'config.json');

const DEFAULTS = {
  telegramToken: '',
  allowedUserIds: [],
  codePath: '',
  // Alt klasörleri de proje olarak listelenecek kök klasörler
  projectRoots: [path.join(os.homedir(), 'Desktop')],
  warmDelayMs: 4000, // VS Code zaten açıksa, linki göndermeden önce bekleme
  coldDelayMs: 8000, // VS Code kapalıysa, ilk açılışta bekleme
  projectsPerPage: 10,
  sessionsPerPage: 8,
  favorites: [], // proje klasör yolları; listede en üstte gösterilir
};

function load() {
  let user = {};
  if (fs.existsSync(CONFIG_FILE)) user = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8').replace(/^﻿/, ''));
  return { ...DEFAULTS, ...user };
}

function save(cfg) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
}

module.exports = { load, save, ROOT, CONFIG_FILE };
