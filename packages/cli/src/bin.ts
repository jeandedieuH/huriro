#!/usr/bin/env node
import { main } from './index'
import { defaultIo } from './io'

process.exitCode = await main(process.argv.slice(2), defaultIo())
