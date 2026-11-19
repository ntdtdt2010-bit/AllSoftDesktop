// @ts-check
/** @type {import('@docusaurus/types').Config} */
const config = {
  title: "Tài liệu AllSoft Desktop",
  tagline: "Hướng dẫn cài đặt và sử dụng phần mềm máy trạm chuẩn hóa",
  favicon: "img/icon.png",
  url: "https://ntdtdt2010-bit.github.io",
  baseUrl: "/AllSoftDesktop/docs/",
  onBrokenLinks: "warn",
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: "warn",
    },
  },
  i18n: {
    defaultLocale: "vi",
    locales: ["vi"],
  },
  presets: [
    [
      "classic",
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          routeBasePath: "/",
          sidebarPath: "./sidebars.js",
        },
        blog: false,
        theme: {
          customCss: "./src/css/custom.css",
        },
      }),
    ],
  ],
  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      navbar: {
        title: "AllSoft Docs",
        logo: {
          alt: "Mr. Dương",
          src: "img/logo.png",
        },
        items: [
          { to: "/", label: "Tổng quan", position: "left" },
          { to: "/launcher", label: "Phần mềm Desktop", position: "left" },
          { to: "/powershell", label: "Lệnh PowerShell", position: "left" },
          { to: "/offline-usb", label: "Offline / USB", position: "left" },
          {
            href: "https://ntdtdt2010-bit.github.io/AllSoftDesktop/admin/",
            label: "Quản trị (Admin)",
            position: "right",
          },
          {
            href: "https://ntdtdt2010-bit.github.io/AllSoftDesktop/",
            label: "← Về Web Portal",
            position: "right",
          },
          {
            href: "https://github.com/ntdtdt2010-bit/AllSoftDesktop",
            label: "GitHub",
            position: "right",
          },
        ],
      },
      footer: {
        style: "light",
        links: [
          {
            title: "Tài liệu hướng dẫn",
            items: [
              { label: "Bắt đầu", to: "/" },
              { label: "Hướng dẫn sử dụng phần mềm", to: "/launcher" },
              { label: "Lệnh 1 dòng PowerShell", to: "/powershell" },
              { label: "Chế độ Offline / USB", to: "/offline-usb" },
              { label: "Thêm phần mềm mới", to: "/contributing-apps" },
            ],
          },
          {
            title: "Hệ thống AllSoft Desktop",
            items: [
              { label: "Web Portal", href: "https://ntdtdt2010-bit.github.io/AllSoftDesktop/" },
              { label: "Trung tâm Quản trị", href: "https://ntdtdt2010-bit.github.io/AllSoftDesktop/admin/" },
              { label: "Nhật ký phát triển", href: "https://ntdtdt2010-bit.github.io/AllSoftDesktop/changelog/" },
            ],
          },
        ],
        copyright: `© 2026 AllSoft Desktop · Created By Mr. Dương`,
      },
      colorMode: {
        defaultMode: "light",
        disableSwitch: true,
        respectPrefersColorScheme: false,
      },
    }),
};

module.exports = config;
