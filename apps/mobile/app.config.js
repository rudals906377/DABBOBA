const PORTONE_CONFIG_PLUGIN = "@portone/react-native-sdk/plugin";

function pluginName(plugin) {
  return Array.isArray(plugin) ? plugin[0] : plugin;
}

function pluginsForCommerceCapability(plugins, capability) {
  const configuredPlugins = Array.isArray(plugins) ? plugins : [];
  if (capability === "LIVE") return configuredPlugins;
  return configuredPlugins.filter((plugin) => pluginName(plugin) !== PORTONE_CONFIG_PLUGIN);
}

function createExpoConfig({ config }) {
  return {
    ...config,
    plugins: pluginsForCommerceCapability(
      config.plugins,
      process.env.EXPO_PUBLIC_COMMERCE_CAPABILITY?.trim(),
    ),
  };
}

module.exports = createExpoConfig;
module.exports.PORTONE_CONFIG_PLUGIN = PORTONE_CONFIG_PLUGIN;
module.exports.pluginsForCommerceCapability = pluginsForCommerceCapability;
