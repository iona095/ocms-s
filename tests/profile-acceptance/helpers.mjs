// S6 acceptance helpers (test-only).
import fs from "node:fs";
import path from "node:path";
import { makeTempHome as makeS4Temp, makeProfile as makeS4Profile, makeFixtureBundle } from "../profile-commit/helpers.mjs";
export function makeS6Root(prefix) { return makeS4Temp(prefix || "ocms-s6-"); }
export function makeS6Profile(home, name, opts) { const d = makeS4Profile(home, name, opts); makeFixtureBundle(d); return d; }
