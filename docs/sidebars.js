/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  docs: [
    {
      type: "category",
      label: "Bắt đầu & Vận hành",
      collapsed: false,
      items: [
        "intro",
        "launcher",
        "powershell",
        "offline-usb",
        "contributing-apps",
      ],
    },
    {
      type: "category",
      label: "Hướng dẫn phần mềm",
      collapsed: false,
      items: [
        "apps/coccoc",
        "apps/onlyoffice",
        "apps/winrar",
        "apps/ultraviewer",
        "apps/lightshot",
        "apps/cpu-z",
        "apps/vnpt-ca",
        "apps/vnegp-agent",
        "apps/xprinter-driver",
        "apps/epson-l8050",
        "seven-zip",
        "git",
      ],
    },
  ],
};

module.exports = sidebars;
