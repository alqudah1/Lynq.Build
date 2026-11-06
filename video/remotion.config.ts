import { Config } from "@remotion/cli/config";
Config.setBrowserExecutable("/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell");
// Sharp output for social: lossless frames, high bitrate, slower encoder preset.
Config.setVideoImageFormat("png");
Config.setCrf(14);
Config.setX264Preset("slow");
Config.setColorSpace("bt709");
Config.setChromiumOpenGlRenderer("swangle");
