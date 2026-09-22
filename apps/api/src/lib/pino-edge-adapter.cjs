'use strict'

const serializersSym = Symbol('dabboba-edge-serializers')

function unsupportedPinoRuntime () {
  throw new Error('Pino transports are unavailable in the Supabase API artifact')
}

unsupportedPinoRuntime.symbols = { serializersSym }
unsupportedPinoRuntime.stdSerializers = { err: () => ({}) }
unsupportedPinoRuntime.destination = unsupportedPinoRuntime

module.exports = unsupportedPinoRuntime
