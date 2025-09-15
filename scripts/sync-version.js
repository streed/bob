#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Read VERSION file
const versionFile = path.join(__dirname, '..', 'VERSION');
const version = fs.readFileSync(versionFile, 'utf8').trim();

// Update root package.json
const rootPackageFile = path.join(__dirname, '..', 'package.json');
const rootPackage = JSON.parse(fs.readFileSync(rootPackageFile, 'utf8'));
rootPackage.version = version;
fs.writeFileSync(rootPackageFile, JSON.stringify(rootPackage, null, 2) + '\n');

// Update backend package.json
const backendPackageFile = path.join(__dirname, '..', 'backend', 'package.json');
const backendPackage = JSON.parse(fs.readFileSync(backendPackageFile, 'utf8'));
backendPackage.version = version;
fs.writeFileSync(backendPackageFile, JSON.stringify(backendPackage, null, 2) + '\n');

// Update frontend package.json
const frontendPackageFile = path.join(__dirname, '..', 'frontend', 'package.json');
const frontendPackage = JSON.parse(fs.readFileSync(frontendPackageFile, 'utf8'));
frontendPackage.version = version;
fs.writeFileSync(frontendPackageFile, JSON.stringify(frontendPackage, null, 2) + '\n');

console.log(`✅ Synced version ${version} to all package.json files`);