"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  AppWindow,
  Award,
  Check,
  CheckCircle2,
  CloudUpload,
  Download,
  Edit3,
  Eye,
  EyeOff,
  FileArchive,
  FileText,
  FolderSync,
  Globe,
  Image as ImageIcon,
  Info,
  KeyRound,
  Layers,
  Loader2,
  Lock,
  LogOut,
  Navigation,
  Palette,
  Plus,
  RotateCcw,
  Save,
  Search,
  Shield,
  Sparkles,
  Trash2,
  Type,
  Upload,
  User,
  X,
  Zap,
} from "lucide-react";
import {
  catalog as staticCatalog,
  defaultBranding,
  AppItem,
  Branding,
  CatalogData,
  Profile,
} from "@/lib/catalog";
import { PRESET_VN_APPS } from "@/lib/presets";
import {
  verifyAdminCredentials,
  changeAdminPassword,
  decryptChangelog,
} from "@/lib/crypto";

type ExtendedDirect = NonNullable<AppItem["direct"]> & {
  offline_filename?: string;
};

type ExtendedAppItem = Omit<AppItem, "direct"> & {
  direct?: ExtendedDirect;
};

interface SiteContent {
  nav_apps: string;
  nav_docs: string;
  nav_changelog: string;
  nav_admin: string;
  hero_badge: string;
  hero_title: string;
  hero_highlight: string;
  hero_subtitle: string;
  btn_download_primary: string;
  btn_download_portable: string;
  hero_version_note: string;
  ps_title: string;
  ps_note: string;
  ps_admin_link: string;
  profiles_eyebrow: string;
  profiles_title: string;
  profiles_subtitle: string;
  catalog_eyebrow: string;
  catalog_title: string;
  catalog_search_placeholder: string;
  footer_desc: string;
  footer_nav_title: string;
  footer_infra_title: string;
  footer_copyright: string;
}

const DEFAULT_SITE_CONTENT: SiteContent = {
  nav_apps: "Phần mềm",
  nav_docs: "Tài liệu",
  nav_changelog: "Nhật ký",
  nav_admin: "Quản trị",
  hero_badge: "Hệ sinh thái chuẩn hóa máy trạm",
  hero_title: "Cài đặt & Chuẩn hóa Máy trạm",
  hero_highlight: "Tự động & Thông minh",
  hero_subtitle:
    "Giải pháp đồng bộ hóa phần mềm văn phòng, y tế, chữ ký số và driver thiết bị ngoại vi tập trung, nhanh gọn và an toàn.",
  btn_download_primary: "Tải Phần mềm AllSoft Desktop cho Windows",
  btn_download_portable: "Bản Portable (.exe)",
  hero_version_note: "Phiên bản 1.0.0 · Dành cho Windows 10 & 11 (64-bit)",
  ps_title: "Cài nhanh bằng 1 dòng lệnh PowerShell (Run as Administrator)",
  ps_note: "Mở PowerShell bằng quyền Quản trị viên và dán lệnh để cài đặt tự động.",
  ps_admin_link: "Tùy chỉnh kho phần mềm →",
  profiles_eyebrow: "GÓI PHẦN MỀM THEO VỊ TRÍ CÔNG TÁC",
  profiles_title: "Hồ sơ Triển khai (Profiles)",
  profiles_subtitle:
    "Chọn hồ sơ bên dưới để lọc nhanh danh sách phần mềm tiêu chuẩn theo từng phòng ban",
  catalog_eyebrow: "KHO PHẦN MỀM CHUẨN HÓA",
  catalog_title: "Danh mục Phần mềm",
  catalog_search_placeholder: "Tìm phần mềm, mã winget, mô tả...",
  footer_desc:
    "Giải pháp chuẩn hóa máy trạm, tự động hóa cài đặt, bảo trì hệ thống và quản trị phần mềm tập trung dành cho bệnh viện, cơ quan hành chính và doanh nghiệp.",
  footer_nav_title: "Điều hướng Hệ thống",
  footer_infra_title: "Hạ tầng & Phát hành",
  footer_copyright: "© 2026 AllSoft Desktop · Created By Mr. Dương",
};

const DEFAULT_LOGO_PATH = "/AllSoftDesktop/logo.png";
const DEFAULT_ICON_PATH = "/AllSoftDesktop/icon.png";

type ExtendedBranding = Branding & {
  icon_url?: string;
};

type ExtendedCatalogData = CatalogData & {
  branding?: ExtendedBranding;
  site_content?: SiteContent;
};

function mergeSiteContent(source?: Partial<SiteContent> | null): SiteContent {
  const staticRaw = (staticCatalog as unknown as { site_content?: Partial<SiteContent> })?.site_content;
  const result = { ...DEFAULT_SITE_CONTENT };
  if (staticRaw && typeof staticRaw === "object") {
    (Object.keys(DEFAULT_SITE_CONTENT) as (keyof SiteContent)[]).forEach((key) => {
      const val = staticRaw[key];
      if (typeof val === "string" && val.trim() !== "") {
        result[key] = val;
      }
    });
  }
  if (source && typeof source === "object") {
    (Object.keys(DEFAULT_SITE_CONTENT) as (keyof SiteContent)[]).forEach((key) => {
      const val = source[key];
      if (typeof val === "string" && val.trim() !== "") {
        result[key] = val;
      }
    });
  }
  return result;
}

interface UploadedInstallerStatus {
  fileName: string;
  sizeMB: string;
  sha256: string;
  mode: "local" | "github" | "pending";
  url?: string;
}

async function computeFileSha256(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default function AdminStudioPage() {
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);
  const [loginUser, setLoginUser] = useState<string>("admin");
  const [loginPass, setLoginPass] = useState<string>("");
  const [showLoginPass, setShowLoginPass] = useState<boolean>(false);
  const [loginLoading, setLoginLoading] = useState<boolean>(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<"apps" | "profiles" | "branding" | "publish">("apps");

  const [catalogState, setCatalogState] = useState<ExtendedCatalogData>(() => ({
    ...staticCatalog,
    branding: { ...defaultBranding, ...(staticCatalog.branding ?? {}) },
    site_content: mergeSiteContent(null),
  }));
  const [brandingState, setBrandingState] = useState<ExtendedBranding>(() => ({
    ...defaultBranding,
    ...(staticCatalog.branding ?? {}),
  }));
  const [siteContentState, setSiteContentState] = useState<SiteContent>(() =>
    mergeSiteContent(null)
  );
  const [logoPreview, setLogoPreview] = useState<string>(DEFAULT_LOGO_PATH);
  const [selectedLogoFile, setSelectedLogoFile] = useState<File | null>(null);
  const [iconPreview, setIconPreview] = useState<string>(DEFAULT_ICON_PATH);
  const [selectedIconFile, setSelectedIconFile] = useState<File | null>(null);
  const [savingCms, setSavingCms] = useState<boolean>(false);

  const [toastMsg, setToastMsg] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);

  // Tab 1: Apps CRUD & Preset Modal
  const [appSearch, setAppSearch] = useState<string>("");
  const [showPresetModal, setShowPresetModal] = useState<boolean>(false);
  const [presetSearch, setPresetSearch] = useState<string>("");
  const [editingApp, setEditingApp] = useState<ExtendedAppItem | null>(null);
  const [isNewApp, setIsNewApp] = useState<boolean>(false);
  const [silentArgsInput, setSilentArgsInput] = useState<string>("/S");

  // Upload bộ cài Direct trong Modal
  const [isDragOver, setIsDragOver] = useState<boolean>(false);
  const [uploadingInstaller, setUploadingInstaller] = useState<boolean>(false);
  const [uploadingGitHubRelease, setUploadingGitHubRelease] = useState<boolean>(false);
  const [pendingInstallerFile, setPendingInstallerFile] = useState<File | null>(null);
  const [installerStatus, setInstallerStatus] = useState<UploadedInstallerStatus | null>(null);

  // Tab 2: Profiles CRUD
  const [editingProfile, setEditingProfile] = useState<Profile | null>(null);
  const [isNewProfile, setIsNewProfile] = useState<boolean>(false);

  // Tab 4: Publish, GitHub Sync & Change Password
  const [ghRepo, setGhRepo] = useState<string>(staticCatalog.repo || "ntdtdt2010-bit/AllSoftDesktop");
  const [ghToken, setGhToken] = useState<string>("");
  const [ghBranch, setGhBranch] = useState<string>("main");
  const [ghSyncing, setGhSyncing] = useState<boolean>(false);
  const [savingSystem, setSavingSystem] = useState<boolean>(false);

  const [currentPassInput, setCurrentPassInput] = useState<string>("");
  const [newPassInput, setNewPassInput] = useState<string>("");
  const [confirmPassInput, setConfirmPassInput] = useState<string>("");

  const fileInputImportRef = useRef<HTMLInputElement | null>(null);
  const logoFileInputRef = useRef<HTMLInputElement | null>(null);
  const iconFileInputRef = useRef<HTMLInputElement | null>(null);
  const installerFileInputRef = useRef<HTMLInputElement | null>(null);

  const showToast = (text: string, type: "success" | "error" | "info" = "success") => {
    setToastMsg({ type, text });
    setTimeout(() => {
      setToastMsg((prev) => (prev?.text === text ? null : prev));
    }, 4200);
  };

  useEffect(() => {
    const logged = sessionStorage.getItem("allsoft_admin_logged_in");
    if (logged === "true") {
      setIsLoggedIn(true);
    }

    const loadInitialData = async () => {
      try {
        const savedLogo = localStorage.getItem("allsoft_custom_logo");
        if (savedLogo) setLogoPreview(savedLogo);
        const savedIcon = localStorage.getItem("allsoft_custom_icon");
        if (savedIcon) setIconPreview(savedIcon);

        const localRaw = localStorage.getItem("allsoft_custom_catalog");
        if (localRaw) {
          const parsed = JSON.parse(localRaw) as ExtendedCatalogData;
          if (parsed && Array.isArray(parsed.apps)) {
            const mergedContent = mergeSiteContent(parsed.site_content);
            setCatalogState({ ...parsed, site_content: mergedContent });
            setSiteContentState(mergedContent);
            if (parsed.branding) {
              setBrandingState({ ...defaultBranding, ...parsed.branding });
              if (!savedLogo && parsed.branding.logo_url) setLogoPreview(parsed.branding.logo_url);
              if (!savedIcon && parsed.branding.icon_url) setIconPreview(parsed.branding.icon_url);
            }
            return;
          }
        }
      } catch {
        // Ignore
      }

      try {
        const res = await fetch("/AllSoftDesktop/api/catalog", { cache: "no-store" });
        if (res.ok) {
          const apiData = (await res.json()) as ExtendedCatalogData;
          if (apiData && Array.isArray(apiData.apps)) {
            const mergedContent = mergeSiteContent(apiData.site_content);
            setCatalogState({ ...apiData, site_content: mergedContent });
            setSiteContentState(mergedContent);
            if (apiData.branding) {
              setBrandingState({ ...defaultBranding, ...apiData.branding });
              const savedLogo = localStorage.getItem("allsoft_custom_logo");
              const savedIcon = localStorage.getItem("allsoft_custom_icon");
              if (!savedLogo && apiData.branding.logo_url) setLogoPreview(apiData.branding.logo_url);
              if (!savedIcon && apiData.branding.icon_url) setIconPreview(apiData.branding.icon_url);
            }
          }
        }
      } catch {
        // Fallback staticCatalog
      }
    };

    loadInitialData();
  }, []);

  // Tự động lưu đồng bộ: localStorage + gọi ngầm /api/save-catalog
  const persistCatalog = (nextCatalog: ExtendedCatalogData, message?: string) => {
    const updated: ExtendedCatalogData = {
      ...nextCatalog,
      updated_at: new Date().toISOString(),
      branding: nextCatalog.branding || brandingState,
      site_content: nextCatalog.site_content || siteContentState,
    };
    setCatalogState(updated);
    try {
      localStorage.setItem("allsoft_custom_catalog", JSON.stringify(updated));
      window.dispatchEvent(new Event("allsoft-catalog-updated"));
    } catch (e) {
      console.error("Lỗi lưu localStorage:", e);
    }

    // Gọi ngầm API lưu xuống catalog/apps.json nếu đang chạy local server
    fetch("/AllSoftDesktop/api/save-catalog", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updated, null, 2),
    })
      .then((res) => {
        if (res.ok) {
          showToast(
            message ? `${message} · Đã lưu & đồng bộ hệ thống` : "Đã lưu & đồng bộ hệ thống",
            "success"
          );
        } else if (message) {
          showToast(message, "success");
        }
      })
      .catch(() => {
        if (message) {
          showToast(message, "success");
        }
      });
  };

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);

    const cleanUser = loginUser.trim().toLowerCase();
    const cleanPass = loginPass;

    if (cleanUser !== "admin") {
      setLoginError("Tài khoản quản trị không hợp lệ (mặc định: admin).");
      return;
    }

    if (!cleanPass) {
      setLoginError("Vui lòng nhập mật khẩu Quản trị viên.");
      return;
    }

    setLoginLoading(true);
    try {
      let verified = await verifyAdminCredentials(cleanUser, cleanPass);

      if (!verified) {
        try {
          await decryptChangelog(cleanPass);
          verified = true;
        } catch {
          verified = false;
        }
      }

      if (verified) {
        sessionStorage.setItem("allsoft_admin_logged_in", "true");
        sessionStorage.setItem("allsoft_changelog_auth", cleanPass);
        setIsLoggedIn(true);
        showToast("Đăng nhập Visual Admin Studio thành công!", "success");
      } else {
        setLoginError("Mật khẩu Quản trị viên không chính xác. Vui lòng kiểm tra lại!");
      }
    } catch {
      setLoginError("Có lỗi xảy ra khi kiểm tra thông tin xác thực.");
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = () => {
    sessionStorage.removeItem("allsoft_admin_logged_in");
    setIsLoggedIn(false);
    setLoginPass("");
  };

  // ==================== TAB 1: QUẢN LÝ PHẦN MỀM ====================
  const filteredApps = useMemo(() => {
    return (catalogState.apps || []).filter((app) => {
      if (!appSearch.trim()) return true;
      const q = appSearch.toLowerCase();
      return (
        app.name.toLowerCase().includes(q) ||
        app.id.toLowerCase().includes(q) ||
        app.category.toLowerCase().includes(q) ||
        app.description.toLowerCase().includes(q) ||
        (app.winget?.id && app.winget.id.toLowerCase().includes(q))
      );
    });
  }, [catalogState.apps, appSearch]);

  const handleAddPresetApp = (preset: AppItem) => {
    const exists = catalogState.apps.some((a) => a.id === preset.id);
    if (exists) {
      showToast(`Phần mềm "${preset.name}" đã có trong danh mục!`, "info");
      return;
    }
    const nextApps = [preset, ...catalogState.apps];
    persistCatalog({ ...catalogState, apps: nextApps }, `Đã thêm nhanh "${preset.name}"`);
  };

  const handleToggleHideApp = (appId: string) => {
    const nextApps = catalogState.apps.map((a) =>
      a.id === appId ? { ...a, hidden: !a.hidden } : a
    );
    persistCatalog({ ...catalogState, apps: nextApps }, "Đã cập nhật trạng thái hiển thị");
  };

  const handleDeleteApp = (appId: string, appName: string) => {
    const nextApps = catalogState.apps.filter((a) => a.id !== appId);
    const nextProfiles = catalogState.profiles.map((p) => ({
      ...p,
      apps: p.apps.filter((id) => id !== appId),
    }));
    persistCatalog(
      { ...catalogState, apps: nextApps, profiles: nextProfiles },
      `Đã xóa "${appName}"`
    );
  };

  const resetInstallerUploadState = () => {
    setIsDragOver(false);
    setUploadingInstaller(false);
    setUploadingGitHubRelease(false);
    setPendingInstallerFile(null);
    setInstallerStatus(null);
  };

  const handleOpenNewAppModal = () => {
    resetInstallerUploadState();
    setIsNewApp(true);
    setSilentArgsInput("/S");
    setEditingApp({
      id: "",
      name: "",
      description: "",
      category: "Tiện ích",
      source: "winget",
      version: "latest",
      winget: { id: "", scope: "machine" },
      direct: {
        url: "",
        installer_type: "exe",
        silent_args: ["/S"],
        sha256: null,
        offline_filename: "",
      },
      dependencies: [],
      changelog_url: "",
      docs_slug: "",
      detect: { display_names: [], registry_keys: [], install_paths: [] },
    });
  };

  const handleOpenEditAppModal = (app: AppItem) => {
    resetInstallerUploadState();
    setIsNewApp(false);
    const cloned: ExtendedAppItem = JSON.parse(JSON.stringify(app));
    const args = cloned.direct?.silent_args || (cloned.direct?.installer_type === "msi" ? ["/qn", "/norestart"] : ["/S"]);
    setSilentArgsInput(args.join(" "));
    if (!cloned.direct) {
      cloned.direct = {
        url: "",
        installer_type: "exe",
        silent_args: ["/S"],
        sha256: null,
        offline_filename: "",
      };
    }
    setEditingApp(cloned);
  };

  const handleInstallerFileProcess = async (file: File) => {
    if (!editingApp) return;

    setUploadingInstaller(true);
    setPendingInstallerFile(file);

    const lowerName = file.name.toLowerCase();
    const detectedType = lowerName.endsWith(".msi") ? "msi" : "exe";
    const suggestedArgs = detectedType === "msi" ? ["/qn", "/norestart"] : ["/S"];
    const sizeMB = (file.size / (1024 * 1024)).toFixed(2);

    try {
      // 1. Tính SHA-256 ngay trên trình duyệt
      const clientSha256 = await computeFileSha256(file);

      // Cập nhật trước các thông tin tự nhận diện
      setSilentArgsInput(suggestedArgs.join(" "));
      setEditingApp((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          source: "direct",
          version: prev.version === "latest" ? "1.0.0" : prev.version,
          direct: {
            url: prev.direct?.url || "",
            installer_type: detectedType,
            silent_args: suggestedArgs,
            sha256: clientSha256,
            offline_filename: file.name,
          },
        };
      });

      // 2. Gọi API local POST /AllSoftDesktop/api/upload-installer để lưu vào packages/
      try {
        const res = await fetch("/AllSoftDesktop/api/upload-installer", {
          method: "POST",
          headers: {
            "x-filename": encodeURIComponent(file.name),
            "Content-Type": "application/octet-stream",
          },
          body: file,
        });

        if (res.ok) {
          const data = await res.json();
          const finalSha = data.sha256 || clientSha256;
          const localUrl = data.localUrl || data.url || "";

          setEditingApp((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              direct: {
                url: localUrl || prev.direct?.url || "",
                installer_type: detectedType,
                silent_args: suggestedArgs,
                sha256: finalSha,
                offline_filename: data.filename || file.name,
              },
            };
          });

          setInstallerStatus({
            fileName: data.filename || file.name,
            sizeMB,
            sha256: finalSha,
            mode: "local",
            url: localUrl,
          });
          showToast(`Đã upload "${file.name}" vào packages/ và điền sẵn SHA-256!`, "success");
          return;
        }
      } catch {
        // Không chạy ở chế độ local server -> chuyển sang chế độ Online/Pending
      }

      // Chế độ Online / Static Web: đã tính xong SHA-256 & gợi ý tham số, chờ upload GitHub Releases hoặc nhập URL
      setInstallerStatus({
        fileName: file.name,
        sizeMB,
        sha256: clientSha256,
        mode: "pending",
      });
      showToast(
        "Đã tính SHA-256 & nhận diện bộ cài! Bạn có thể Upload lên GitHub Releases hoặc dán Direct URL.",
        "info"
      );
    } catch {
      showToast("Không thể đọc hoặc tính SHA-256 của tệp bộ cài.", "error");
    } finally {
      setUploadingInstaller(false);
    }
  };

  const handleUploadInstallerToGitHubRelease = async () => {
    if (!pendingInstallerFile) return;
    if (!ghRepo.trim() || !ghToken.trim()) {
      showToast("Vui lòng nhập GitHub Token & Repo ở Tab 4 trước khi upload lên GitHub Releases!", "error");
      return;
    }

    setUploadingGitHubRelease(true);
    try {
      const repo = ghRepo.trim();
      const tag = "apps-v1";
      const headers: Record<string, string> = {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${ghToken.trim()}`,
      };

      // Kiểm tra release apps-v1 đã tồn tại chưa, chưa thì tạo mới
      let releaseData: { upload_url?: string } | null = null;
      const getRelRes = await fetch(`https://api.github.com/repos/${repo}/releases/tags/${tag}`, {
        headers,
      });

      if (getRelRes.ok) {
        releaseData = await getRelRes.json();
      } else if (getRelRes.status === 404) {
        const createRelRes = await fetch(`https://api.github.com/repos/${repo}/releases`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({
            tag_name: tag,
            name: "AllSoft Desktop App Installers (v1)",
            body: "Kho lưu trữ tệp bộ cài Direct (.exe / .msi) cho AllSoft Desktop.",
            draft: false,
            prerelease: false,
          }),
        });
        if (!createRelRes.ok) {
          const err = await createRelRes.json().catch(() => ({}));
          throw new Error(err.message || `Không thể tạo release ${tag} (HTTP ${createRelRes.status})`);
        }
        releaseData = await createRelRes.json();
      } else {
        throw new Error(`Không thể truy cập GitHub Releases (HTTP ${getRelRes.status})`);
      }

      const uploadUrlTemplate = releaseData?.upload_url;
      if (!uploadUrlTemplate) {
        throw new Error("Không nhận được upload_url từ GitHub Releases.");
      }

      const cleanUploadUrl = uploadUrlTemplate.replace(/\{[^}]+\}$/, "");
      const uploadRes = await fetch(
        `${cleanUploadUrl}?name=${encodeURIComponent(pendingInstallerFile.name)}`,
        {
          method: "POST",
          headers: {
            ...headers,
            "Content-Type": "application/octet-stream",
          },
          body: pendingInstallerFile,
        }
      );

      if (!uploadRes.ok) {
        const err = await uploadRes.json().catch(() => ({}));
        throw new Error(err.message || `Lỗi upload asset (HTTP ${uploadRes.status})`);
      }

      const assetData = await uploadRes.json();
      const downloadUrl: string = assetData.browser_download_url || "";

      setEditingApp((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          direct: {
            url: downloadUrl,
            installer_type: prev.direct?.installer_type || "exe",
            silent_args: prev.direct?.silent_args || ["/S"],
            sha256: prev.direct?.sha256 || installerStatus?.sha256 || null,
            offline_filename: prev.direct?.offline_filename || pendingInstallerFile.name,
          },
        };
      });

      setInstallerStatus((prev) =>
        prev ? { ...prev, mode: "github", url: downloadUrl } : null
      );
      showToast("Đã upload bộ cài lên GitHub Releases (apps-v1) thành công!", "success");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Không thể upload lên GitHub Releases";
      showToast(`Lỗi upload GitHub Releases: ${msg}`, "error");
    } finally {
      setUploadingGitHubRelease(false);
    }
  };

  const handleSaveAppModal = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingApp) return;

    const cleanName = editingApp.name.trim();
    const cleanId =
      editingApp.id.trim() ||
      cleanName
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");

    if (!cleanId || !cleanName) {
      showToast("Vui lòng nhập đầy đủ Tên phần mềm và Mã định danh (ID)!", "error");
      return;
    }

    const parsedSilentArgs = silentArgsInput
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    const existingDisplayNames = (editingApp.detect?.display_names || [])
      .map((s) => s.trim())
      .filter(Boolean);

    const finalDetect = {
      display_names: existingDisplayNames.length > 0 ? existingDisplayNames : [cleanName],
      registry_keys: editingApp.detect?.registry_keys || [],
      install_paths: editingApp.detect?.install_paths || [],
    };

    const finalApp: ExtendedAppItem = {
      ...editingApp,
      id: cleanId,
      name: cleanName,
      docs_slug: editingApp.docs_slug || cleanId,
      detect: finalDetect,
    };

    if (finalApp.source === "direct") {
      finalApp.direct = {
        url: finalApp.direct?.url?.trim() || "",
        installer_type: finalApp.direct?.installer_type || "exe",
        silent_args:
          parsedSilentArgs.length > 0
            ? parsedSilentArgs
            : finalApp.direct?.installer_type === "msi"
            ? ["/qn", "/norestart"]
            : ["/S"],
        sha256: finalApp.direct?.sha256?.trim() || null,
        ...(finalApp.direct?.offline_filename?.trim()
          ? { offline_filename: finalApp.direct.offline_filename.trim() }
          : {}),
      };
    }

    const appToStore = finalApp as AppItem;
    let nextApps: AppItem[];
    if (isNewApp) {
      if (catalogState.apps.some((a) => a.id === cleanId)) {
        showToast(`Mã phần mềm "${cleanId}" đã tồn tại!`, "error");
        return;
      }
      nextApps = [appToStore, ...catalogState.apps];
    } else {
      nextApps = catalogState.apps.map((a) => (a.id === editingApp.id ? appToStore : a));
    }

    persistCatalog(
      { ...catalogState, apps: nextApps },
      isNewApp ? `Đã thêm mới "${appToStore.name}"` : `Đã lưu thay đổi "${appToStore.name}"`
    );
    setEditingApp(null);
    resetInstallerUploadState();
  };

  // ==================== TAB 2: QUẢN LÝ HỒ SƠ MÁY (PROFILES) ====================
  const handleOpenNewProfileModal = () => {
    setIsNewProfile(true);
    setEditingProfile({
      id: "",
      name: "",
      description: "",
      apps: [],
    });
  };

  const handleOpenEditProfileModal = (profile: Profile) => {
    setIsNewProfile(false);
    setEditingProfile(JSON.parse(JSON.stringify(profile)));
  };

  const handleDeleteProfile = (profileId: string, profileName: string) => {
    const nextProfiles = catalogState.profiles.filter((p) => p.id !== profileId);
    persistCatalog({ ...catalogState, profiles: nextProfiles }, `Đã xóa hồ sơ "${profileName}"`);
  };

  const handleSaveProfileModal = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProfile) return;

    const cleanId =
      editingProfile.id.trim() ||
      editingProfile.name
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");

    if (!cleanId || !editingProfile.name.trim()) {
      showToast("Vui lòng nhập Tên hồ sơ máy!", "error");
      return;
    }

    const finalProfile: Profile = {
      ...editingProfile,
      id: cleanId,
    };

    let nextProfiles: Profile[];
    if (isNewProfile) {
      nextProfiles = [...catalogState.profiles, finalProfile];
    } else {
      nextProfiles = catalogState.profiles.map((p) => (p.id === editingProfile.id ? finalProfile : p));
    }

    persistCatalog(
      { ...catalogState, profiles: nextProfiles },
      isNewProfile ? `Đã tạo hồ sơ "${finalProfile.name}"` : `Đã cập nhật hồ sơ "${finalProfile.name}"`
    );
    setEditingProfile(null);
  };

  const toggleAppInEditingProfile = (appId: string) => {
    if (!editingProfile) return;
    const exists = editingProfile.apps.includes(appId);
    const nextApps = exists
      ? editingProfile.apps.filter((id) => id !== appId)
      : [...editingProfile.apps, appId];
    setEditingProfile({ ...editingProfile, apps: nextApps });
  };

  // ==================== TAB 3: GIAO DIỆN, CHỮ & HÌNH ẢNH (FULL UI CMS) ====================
  const handleSelectLogoFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedLogoFile(file);

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setLogoPreview(reader.result);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleSelectIconFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedIconFile(file);

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setIconPreview(reader.result);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const updateSiteField = <K extends keyof SiteContent>(key: K, value: string) => {
    setSiteContentState((prev) => ({ ...prev, [key]: value }));
  };

  const handleResetSiteText = () => {
    const restoredContent: SiteContent = { ...DEFAULT_SITE_CONTENT };
    const restoredBranding: ExtendedBranding = {
      ...brandingState,
      app_name: defaultBranding.app_name,
      hero_badge: restoredContent.hero_badge,
      hero_title: restoredContent.hero_title,
      hero_highlight: restoredContent.hero_highlight,
      hero_subtitle: restoredContent.hero_subtitle,
      logo_url: logoPreview,
      icon_url: iconPreview,
    };

    setSiteContentState(restoredContent);
    setBrandingState(restoredBranding);
    persistCatalog(
      {
        ...catalogState,
        launcher: {
          ...catalogState.launcher,
          name: restoredBranding.app_name,
        },
        branding: restoredBranding,
        site_content: restoredContent,
      },
      "Đã khôi phục toàn bộ văn bản về mặc định gốc"
    );
  };

  const handleSaveBranding = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingCms(true);

    try {
      const nextBranding: ExtendedBranding = {
        ...brandingState,
        logo_url: logoPreview || DEFAULT_LOGO_PATH,
        icon_url: iconPreview || DEFAULT_ICON_PATH,
        hero_badge: siteContentState.hero_badge,
        hero_title: siteContentState.hero_title,
        hero_highlight: siteContentState.hero_highlight,
        hero_subtitle: siteContentState.hero_subtitle,
      };

      try {
        if (logoPreview && logoPreview !== DEFAULT_LOGO_PATH) {
          localStorage.setItem("allsoft_custom_logo", logoPreview);
        } else {
          localStorage.removeItem("allsoft_custom_logo");
        }
        if (iconPreview && iconPreview !== DEFAULT_ICON_PATH) {
          localStorage.setItem("allsoft_custom_icon", iconPreview);
        } else {
          localStorage.removeItem("allsoft_custom_icon");
        }
      } catch {
        // Ignore quota errors
      }

      if (selectedLogoFile && logoPreview.startsWith("data:")) {
        try {
          await fetch("/AllSoftDesktop/api/upload-logo", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dataUrl: logoPreview }),
          });
        } catch {
          // Static export fallback
        }
      }

      if (selectedIconFile && iconPreview.startsWith("data:")) {
        try {
          await fetch("/AllSoftDesktop/api/upload-icon", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dataUrl: iconPreview }),
          });
        } catch {
          // Static export fallback
        }
      }

      const nextCatalog: ExtendedCatalogData = {
        ...catalogState,
        launcher: {
          ...catalogState.launcher,
          name: nextBranding.app_name,
        },
        branding: nextBranding,
        site_content: { ...siteContentState },
      };

      setBrandingState(nextBranding);
      setSelectedLogoFile(null);
      setSelectedIconFile(null);
      persistCatalog(nextCatalog, "Đã lưu toàn bộ Giao diện, Chữ & Hình ảnh");
    } finally {
      setSavingCms(false);
    }
  };

  // ==================== TAB 4: XUẤT BẢN, SAO LƯU & MẬT KHẨU ====================
  const handleSaveToSystem = async () => {
    setSavingSystem(true);
    const updatedCatalog: ExtendedCatalogData = {
      ...catalogState,
      updated_at: new Date().toISOString(),
      branding: {
        ...brandingState,
        logo_url: logoPreview || DEFAULT_LOGO_PATH,
        icon_url: iconPreview || DEFAULT_ICON_PATH,
      },
      site_content: siteContentState,
    };

    setCatalogState(updatedCatalog);
    try {
      localStorage.setItem("allsoft_custom_catalog", JSON.stringify(updatedCatalog));
      window.dispatchEvent(new Event("allsoft-catalog-updated"));
    } catch {
      // Ignore
    }

    try {
      const res = await fetch("/AllSoftDesktop/api/save-catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatedCatalog, null, 2),
      });

      if (res.ok) {
        showToast("Đã lưu & đồng bộ trực tiếp vào catalog/apps.json!", "success");
      } else {
        showToast("Đã lưu trực tiếp vào bộ nhớ Trình duyệt! (Chế độ Static Web)", "success");
      }
    } catch {
      showToast("Đã lưu vào bộ nhớ Trình duyệt tức thì! Bạn có thể Xuất file apps.json hoặc Đồng bộ GitHub.", "success");
    } finally {
      setSavingSystem(false);
    }
  };

  const handleGitHubCloudSync = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ghRepo.trim() || !ghToken.trim()) {
      showToast("Vui lòng nhập đầy đủ GitHub Repository (owner/repo) và Personal Access Token!", "error");
      return;
    }

    setGhSyncing(true);
    try {
      const apiUrl = `https://api.github.com/repos/${ghRepo.trim()}/contents/catalog/apps.json`;
      const headers: Record<string, string> = {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${ghToken.trim()}`,
      };

      let currentSha: string | undefined;
      const getRes = await fetch(`${apiUrl}?ref=${encodeURIComponent(ghBranch.trim())}`, {
        headers,
      });
      if (getRes.ok) {
        const fileMeta = await getRes.json();
        currentSha = fileMeta.sha;
      }

      const contentJson = JSON.stringify(
        {
          ...catalogState,
          updated_at: new Date().toISOString(),
          branding: brandingState,
          site_content: siteContentState,
        },
        null,
        2
      );

      const utf8Bytes = new TextEncoder().encode(contentJson);
      let binaryStr = "";
      utf8Bytes.forEach((b) => {
        binaryStr += String.fromCharCode(b);
      });
      const base64Content = btoa(binaryStr);

      const putRes = await fetch(apiUrl, {
        method: "PUT",
        headers: {
          ...headers,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: `chore(catalog): cập nhật danh mục phần mềm từ Visual Admin Studio (${new Date().toLocaleDateString("vi-VN")})`,
          content: base64Content,
          sha: currentSha,
          branch: ghBranch.trim() || "main",
        }),
      });

      if (!putRes.ok) {
        const errData = await putRes.json().catch(() => ({}));
        throw new Error(errData.message || `HTTP ${putRes.status}`);
      }

      showToast("Xuất bản catalog/apps.json lên GitHub thành công!", "success");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Không thể kết nối";
      showToast(`Lỗi đồng bộ GitHub: ${msg}`, "error");
    } finally {
      setGhSyncing(false);
    }
  };

  const handleExportAppsJson = () => {
    const content = JSON.stringify(
      {
        ...catalogState,
        updated_at: new Date().toISOString(),
        branding: brandingState,
        site_content: siteContentState,
      },
      null,
      2
    );
    const blob = new Blob([content], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "apps.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("Đã tải xuống tệp apps.json!", "success");
  };

  const handleImportAppsJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as ExtendedCatalogData;
        if (!parsed || !Array.isArray(parsed.apps)) {
          showToast("Tệp JSON không đúng định dạng catalog/apps.json!", "error");
          return;
        }
        if (parsed.branding) {
          setBrandingState({ ...defaultBranding, ...parsed.branding });
          if (parsed.branding.logo_url) setLogoPreview(parsed.branding.logo_url);
          if (parsed.branding.icon_url) setIconPreview(parsed.branding.icon_url);
        }
        const mergedContent = mergeSiteContent(parsed.site_content);
        setSiteContentState(mergedContent);
        persistCatalog(
          { ...parsed, site_content: mergedContent },
          `Đã nhập thành công ${parsed.apps.length} phần mềm`
        );
      } catch {
        showToast("Không thể đọc tệp JSON. Vui lòng kiểm tra cú pháp tệp!", "error");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleResetDefault = () => {
    localStorage.removeItem("allsoft_custom_catalog");
    localStorage.removeItem("allsoft_custom_logo");
    localStorage.removeItem("allsoft_custom_icon");
    const restoredContent = { ...DEFAULT_SITE_CONTENT };
    setBrandingState({ ...defaultBranding, icon_url: DEFAULT_ICON_PATH });
    setSiteContentState(restoredContent);
    setLogoPreview(DEFAULT_LOGO_PATH);
    setIconPreview(DEFAULT_ICON_PATH);
    setSelectedLogoFile(null);
    setSelectedIconFile(null);
    setCatalogState({
      ...staticCatalog,
      branding: { ...defaultBranding, icon_url: DEFAULT_ICON_PATH },
      site_content: restoredContent,
    });
    window.dispatchEvent(new Event("allsoft-catalog-updated"));
    showToast("Đã khôi phục toàn bộ danh mục và giao diện về mặc định gốc!", "info");
  };

  const handleChangeAdminPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassInput || !newPassInput) {
      showToast("Vui lòng nhập mật khẩu hiện tại và mật khẩu mới!", "error");
      return;
    }
    if (newPassInput !== confirmPassInput) {
      showToast("Mật khẩu xác nhận không khớp!", "error");
      return;
    }
    const validOld = await verifyAdminCredentials("admin", currentPassInput);
    if (!validOld) {
      showToast("Mật khẩu hiện tại không chính xác!", "error");
      return;
    }
    await changeAdminPassword("admin", newPassInput);
    setCurrentPassInput("");
    setNewPassInput("");
    setConfirmPassInput("");
    showToast("Đã cập nhật mật khẩu Quản trị viên mới (PBKDF2-SHA256) thành công!", "success");
  };

  // ==================== GIAO DIỆN CỔNG KHÓA ĐĂNG NHẬP ====================
  if (!isLoggedIn) {
    return (
      <div className="max-w-md mx-auto px-4 py-14 w-full animate-fade-up">
        <div className="card-spotlight rounded-3xl p-8 text-center relative overflow-hidden">
          <div className="absolute -top-20 -right-20 w-40 h-40 bg-[#C5A044]/15 rounded-full blur-2xl pointer-events-none" />

          <div className="flex justify-center mb-5">
            <img
              src={logoPreview}
              alt="Mr. Dương"
              className="w-[220px] min-w-[200px] h-auto object-contain"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).src = DEFAULT_LOGO_PATH;
              }}
            />
          </div>

          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#FBF7EC] border border-[#EAE2CE] text-[#8A6D23] text-[11px] font-bold mb-2">
            <Shield className="w-3.5 h-3.5 text-[#B5943B]" />
            <span>VISUAL ADMIN STUDIO</span>
          </div>

          <h1 className="text-2xl font-extrabold text-[#2D2D2D]">
            Cổng Quản trị Hệ thống
          </h1>
          <p className="text-xs text-[#5C5649] mt-1 mb-6">
            Quản lý danh mục phần mềm, hồ sơ máy trạm và cấu hình triển khai tập trung
          </p>

          <form onSubmit={handleAdminLogin} className="space-y-4 text-left">
            <div>
              <label className="block text-xs font-bold text-[#2D2D2D] mb-1">
                Tài khoản Quản trị viên
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={loginUser}
                  onChange={(e) => setLoginUser(e.target.value)}
                  placeholder="admin"
                  className="w-full pl-10 pr-4 py-2.5 text-sm rounded-xl border border-[#EAE2CE] bg-[#FDFBF7] text-[#2D2D2D] focus:border-[#B5943B] focus:ring-2 focus:ring-[#B5943B]/20 focus:outline-none"
                />
                <User className="w-4 h-4 text-[#B5943B] absolute left-3.5 top-1/2 -translate-y-1/2" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-[#2D2D2D] mb-1">
                Mật khẩu Quản trị
              </label>
              <div className="relative">
                <input
                  type={showLoginPass ? "text" : "password"}
                  value={loginPass}
                  onChange={(e) => setLoginPass(e.target.value)}
                  placeholder="Nhập mật khẩu quản trị..."
                  className="w-full pl-10 pr-10 py-2.5 text-sm rounded-xl border border-[#EAE2CE] bg-[#FDFBF7] text-[#2D2D2D] focus:border-[#B5943B] focus:ring-2 focus:ring-[#B5943B]/20 focus:outline-none"
                  autoFocus
                />
                <KeyRound className="w-4 h-4 text-[#B5943B] absolute left-3.5 top-1/2 -translate-y-1/2" />
                <button
                  type="button"
                  onClick={() => setShowLoginPass(!showLoginPass)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#5C5649] hover:text-[#2D2D2D] cursor-pointer"
                >
                  {showLoginPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {loginError && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{loginError}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loginLoading}
              className="btn-shimmer w-full py-3 px-4 rounded-xl bg-gradient-to-r from-[#C5A044] to-[#9A7B2C] hover:from-[#B5943B] hover:to-[#8A6D23] text-white font-bold text-sm shadow-lg shadow-[#B5943B]/25 active:scale-[0.98] transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              {loginLoading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Đang xác thực PBKDF2...</span>
                </>
              ) : (
                <>
                  <Lock className="w-4 h-4" />
                  <span>Đăng nhập Quản trị viên</span>
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ==================== GIAO DIỆN BẢNG ĐIỀU KHIỂN 4 TAB ====================
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full animate-fade-up">
      {toastMsg && (
        <div className="toast-slide fixed bottom-6 right-6 z-50 max-w-md rounded-2xl bg-[#2B2B2B] text-white border border-[#C5A044] px-5 py-3.5 shadow-2xl flex items-center gap-3">
          {toastMsg.type === "error" ? (
            <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />
          ) : (
            <CheckCircle2 className="w-5 h-5 text-[#C5A044] shrink-0" />
          )}
          <span className="text-xs sm:text-sm font-semibold">{toastMsg.text}</span>
          <button
            onClick={() => setToastMsg(null)}
            className="text-white/60 hover:text-white ml-2 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Header Dashboard */}
      <div className="card-spotlight rounded-2xl p-5 sm:p-6 mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <img
            src={logoPreview}
            alt="Mr. Dương"
            className="w-[200px] min-w-[200px] h-auto object-contain self-start sm:self-center shrink-0"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).src = DEFAULT_LOGO_PATH;
            }}
          />
          <span className="hidden sm:block h-10 w-px bg-[#E5DEC9] shrink-0" aria-hidden="true" />
          <div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#FBF7EC] border border-[#EAE2CE] text-[#8A6D23] text-[10px] font-bold uppercase tracking-wider mb-1">
              <Sparkles className="w-3 h-3 text-[#B5943B]" />
              <span>Visual Admin Studio</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-extrabold text-[#2D2D2D]">
              Trung tâm Quản trị Phần mềm & Thương hiệu
            </h1>
            <p className="text-xs text-[#5C5649]">
              Đang quản lý <strong>{catalogState.apps.length}</strong> phần mềm và{" "}
              <strong>{catalogState.profiles.length}</strong> hồ sơ máy trạm. Mọi thay đổi tự động lưu & đồng bộ!
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={handleSaveToSystem}
            disabled={savingSystem}
            className="btn-shimmer inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-[#C5A044] to-[#9A7B2C] text-white text-xs font-bold shadow-md shadow-[#B5943B]/20 active:scale-[0.98] cursor-pointer"
          >
            <Save className="w-4 h-4" />
            <span>{savingSystem ? "Đang lưu..." : "Lưu trực tiếp vào Hệ thống"}</span>
          </button>

          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-[#2B2B2B] hover:bg-[#3D3D3D] text-white text-xs font-bold active:scale-[0.98] transition-all cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5 text-[#C5A044]" />
            <span>Đăng xuất</span>
          </button>
        </div>
      </div>

      {/* Thanh chuyển 4 Tab */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 mb-6">
        <button
          type="button"
          onClick={() => setActiveTab("apps")}
          className={`flex items-center gap-2 px-4 py-3 rounded-xl text-xs sm:text-sm font-bold whitespace-nowrap active:scale-[0.98] transition-all cursor-pointer ${
            activeTab === "apps"
              ? "bg-gradient-to-r from-[#C5A044] to-[#9A7B2C] text-white shadow-md shadow-[#B5943B]/20"
              : "bg-white text-[#5C5649] border border-[#EAE2CE] hover:bg-[#FBF7EC] hover:text-[#8A6D23]"
          }`}
        >
          <AppWindow className="w-4 h-4" />
          <span>1. Quản lý Phần mềm ({catalogState.apps.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("profiles")}
          className={`flex items-center gap-2 px-4 py-3 rounded-xl text-xs sm:text-sm font-bold whitespace-nowrap active:scale-[0.98] transition-all cursor-pointer ${
            activeTab === "profiles"
              ? "bg-gradient-to-r from-[#C5A044] to-[#9A7B2C] text-white shadow-md shadow-[#B5943B]/20"
              : "bg-white text-[#5C5649] border border-[#EAE2CE] hover:bg-[#FBF7EC] hover:text-[#8A6D23]"
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>2. Quản lý Hồ sơ Máy ({catalogState.profiles.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("branding")}
          className={`flex items-center gap-2 px-4 py-3 rounded-xl text-xs sm:text-sm font-bold whitespace-nowrap active:scale-[0.98] transition-all cursor-pointer ${
            activeTab === "branding"
              ? "bg-gradient-to-r from-[#C5A044] to-[#9A7B2C] text-white shadow-md shadow-[#B5943B]/20"
              : "bg-white text-[#5C5649] border border-[#EAE2CE] hover:bg-[#FBF7EC] hover:text-[#8A6D23]"
          }`}
        >
          <Palette className="w-4 h-4" />
          <span>3. Giao diện, Chữ &amp; Hình ảnh</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("publish")}
          className={`flex items-center gap-2 px-4 py-3 rounded-xl text-xs sm:text-sm font-bold whitespace-nowrap active:scale-[0.98] transition-all cursor-pointer ${
            activeTab === "publish"
              ? "bg-gradient-to-r from-[#C5A044] to-[#9A7B2C] text-white shadow-md shadow-[#B5943B]/20"
              : "bg-white text-[#5C5649] border border-[#EAE2CE] hover:bg-[#FBF7EC] hover:text-[#8A6D23]"
          }`}
        >
          <FolderSync className="w-4 h-4" />
          <span>4. Xuất bản, Sao lưu & Mật khẩu</span>
        </button>
      </div>

      {/* ==================== NỘI DUNG TAB 1: QUẢN LÝ PHẦN MỀM ==================== */}
      {activeTab === "apps" && (
        <div className="space-y-6 animate-fade-up">
          <div className="card-spotlight rounded-2xl p-5 bg-gradient-to-r from-[#FBF7EC] via-white to-[#FBF7EC] border-[#C5A044]/60 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-1.5 text-xs font-extrabold text-[#8A6D23] mb-1">
                <Zap className="w-4 h-4 text-[#B5943B]" />
                <span>KHO THƯ VIỆN MẪU TỰ ĐỘNG</span>
              </div>
              <h3 className="text-base sm:text-lg font-extrabold text-[#2D2D2D]">
                ⚡ Kho 25+ Phần mềm Thông dụng tại Việt Nam (Chọn 1-Click)
              </h3>
              <p className="text-xs text-[#5C5649] mt-0.5">
                Tích hợp sẵn mã cài đặt chuẩn cho Zalo PC, Chrome, Unikey, EVKey, AnyDesk, UltraViewer, Foxit, Viettel-CA, VNPT-CA, HIS Client, Canon LBP2900...
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 shrink-0">
              <button
                type="button"
                onClick={() => setShowPresetModal(true)}
                className="btn-shimmer inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#2B2B2B] hover:bg-[#3D3D3D] text-[#FBF7EC] text-xs font-bold shadow-sm active:scale-[0.98] cursor-pointer"
              >
                <Zap className="w-4 h-4 text-[#C5A044]" />
                <span>Mở Kho 25+ Phần mềm Mẫu</span>
              </button>

              <button
                type="button"
                onClick={handleOpenNewAppModal}
                className="btn-shimmer inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-[#C5A044] to-[#9A7B2C] text-white text-xs font-bold shadow-sm active:scale-[0.98] cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>+ Thêm phần mềm mới</span>
              </button>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative w-full sm:w-96">
              <Search className="w-4 h-4 text-[#8A6D23] absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={appSearch}
                onChange={(e) => setAppSearch(e.target.value)}
                placeholder="Tìm kiếm phần mềm trong danh mục..."
                className="w-full pl-10 pr-4 py-2.5 text-xs sm:text-sm rounded-xl border border-[#EAE2CE] bg-white text-[#2D2D2D] focus:border-[#B5943B] focus:outline-none"
              />
            </div>

            <span className="text-xs font-bold text-[#5C5649]">
              Hiển thị {filteredApps.length} / {catalogState.apps.length} phần mềm
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredApps.map((app) => (
              <div
                key={app.id}
                className={`card-spotlight rounded-2xl p-4 flex flex-col justify-between ${
                  app.hidden ? "opacity-65 bg-[#FDFBF7]" : ""
                }`}
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-extrabold text-sm sm:text-base text-[#2D2D2D]">
                          {app.name}
                        </h4>
                        {app.hidden && (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#2B2B2B] text-white">
                            Đang ẩn
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] font-bold text-[#8A6D23]">
                        {app.category} · ID: {app.id}
                      </span>
                    </div>

                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#FBF7EC] text-[#8A6D23] border border-[#EAE2CE] shrink-0">
                      {app.source === "winget" ? `winget: ${app.winget?.id}` : `Direct v${app.version}`}
                    </span>
                  </div>

                  <p className="text-xs text-[#5C5649] leading-relaxed mb-4">
                    {app.description}
                  </p>
                </div>

                <div className="pt-3 border-t border-[#EAE2CE] flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => handleToggleHideApp(app.id)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-[#FDFBF7] hover:bg-[#FBF7EC] text-[#5C5649] hover:text-[#2D2D2D] border border-[#EAE2CE] active:scale-[0.98] cursor-pointer"
                  >
                    {app.hidden ? <Eye className="w-3.5 h-3.5 text-[#B5943B]" /> : <EyeOff className="w-3.5 h-3.5" />}
                    <span>{app.hidden ? "Hiện lên" : "Ẩn đi"}</span>
                  </button>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleOpenEditAppModal(app)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-[#FBF7EC] hover:bg-[#F3E9CE] text-[#8A6D23] border border-[#EAE2CE] active:scale-[0.98] cursor-pointer"
                    >
                      <Edit3 className="w-3.5 h-3.5 text-[#B5943B]" />
                      <span>Sửa</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDeleteApp(app.id, app.name)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 active:scale-[0.98] cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Xóa</span>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ==================== NỘI DUNG TAB 2: QUẢN LÝ HỒ SƠ MÁY ==================== */}
      {activeTab === "profiles" && (
        <div className="space-y-6 animate-fade-up">
          <div className="card-spotlight rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-base sm:text-lg font-extrabold text-[#2D2D2D]">
                Quản lý Hồ sơ Triển khai theo Phòng ban (Profiles)
              </h3>
              <p className="text-xs text-[#5C5649]">
                Tạo các gói cài đặt tiêu chuẩn cho Máy Văn phòng, Kế toán, Lễ tân, Kỹ thuật, Bác sĩ, Dược sĩ...
              </p>
            </div>

            <button
              type="button"
              onClick={handleOpenNewProfileModal}
              className="btn-shimmer inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-[#C5A044] to-[#9A7B2C] text-white text-xs font-bold shadow-sm active:scale-[0.98] cursor-pointer self-start sm:self-auto"
            >
              <Plus className="w-4 h-4" />
              <span>+ Thêm Hồ sơ Máy mới</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {catalogState.profiles.map((profile) => (
              <div key={profile.id} className="card-spotlight rounded-2xl p-5 flex flex-col justify-between">
                <div>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div>
                      <h4 className="font-extrabold text-base text-[#2D2D2D]">
                        {profile.name}
                      </h4>
                      <span className="text-[11px] font-bold text-[#8A6D23]">
                        Mã hồ sơ: {profile.id}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleOpenEditProfileModal(profile)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-[#FBF7EC] hover:bg-[#F3E9CE] text-[#8A6D23] border border-[#EAE2CE] active:scale-[0.98] cursor-pointer"
                      >
                        <Edit3 className="w-3.5 h-3.5 text-[#B5943B]" />
                        <span>Chọn phần mềm / Sửa</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDeleteProfile(profile.id, profile.name)}
                        className="p-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 active:scale-[0.98] cursor-pointer"
                        title="Xóa hồ sơ"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <p className="text-xs text-[#5C5649] mb-4">
                    {profile.description}
                  </p>
                </div>

                <div className="pt-3 border-t border-[#EAE2CE]">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#8A6D23] block mb-2">
                    Gồm {profile.apps.length} phần mềm được gán:
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {profile.apps.map((appId) => {
                      const appObj = catalogState.apps.find((a) => a.id === appId);
                      return (
                        <span
                          key={appId}
                          className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-[#FBF7EC] text-[#8A6D23] border border-[#EAE2CE]"
                        >
                          {appObj?.name || appId}
                        </span>
                      );
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ==================== NỘI DUNG TAB 3: GIAO DIỆN, CHỮ & HÌNH ẢNH (FULL UI CMS) ==================== */}
      {activeTab === "branding" && (
        <form onSubmit={handleSaveBranding} className="space-y-6 animate-fade-up">
          {/* NHÓM 1: HÌNH ẢNH (LOGO CHÍNH 200PX & ICON / FAVICON) + THÔNG TIN CHUNG */}
          <div className="card-spotlight rounded-2xl p-6 space-y-6">
            <div className="pb-3 border-b border-[#EAE2CE] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <div className="inline-flex items-center gap-1.5 text-[11px] font-extrabold text-[#8A6D23] uppercase tracking-wider mb-0.5">
                  <ImageIcon className="w-3.5 h-3.5 text-[#B5943B]" />
                  <span>NHÓM 1 · NHẬN DIỆN THƯƠNG HIỆU</span>
                </div>
                <h3 className="text-base sm:text-lg font-extrabold text-[#2D2D2D]">
                  Hình ảnh (Logo chính 200px &amp; Icon phần mềm / Favicon)
                </h3>
              </div>
              <span className="text-[11px] text-[#5C5649] bg-[#FBF7EC] border border-[#EAE2CE] px-3 py-1 rounded-full font-semibold self-start sm:self-center">
                Đồng bộ tức thì lên Header, Footer, Tab trình duyệt &amp; Docs
              </span>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {/* Khung Logo chính */}
              <div className="p-5 rounded-2xl bg-[#FDFBF7] border-2 border-dashed border-[#C5A044]/60 flex flex-col justify-between gap-4">
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <h4 className="text-sm font-extrabold text-[#2D2D2D] flex items-center gap-1.5">
                      <Award className="w-4 h-4 text-[#B5943B]" />
                      <span>Logo chính (W: 200px · H: auto)</span>
                    </h4>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-white border border-[#EAE2CE] text-[#8A6D23]">
                      PNG / SVG / WEBP
                    </span>
                  </div>
                  <p className="text-[11px] text-[#5C5649] mb-4">
                    Hiển thị trực tiếp trên thanh điều hướng, chân trang, trang Tài liệu và Desktop Launcher.
                  </p>

                  <div className="w-full min-h-[108px] py-4 px-4 rounded-xl bg-white border border-[#EAE2CE] flex items-center justify-center shadow-2xs">
                    <img
                      src={logoPreview}
                      alt="Xem trước Logo chính"
                      className="w-[200px] min-w-[200px] h-auto max-w-full object-contain"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).src = DEFAULT_LOGO_PATH;
                      }}
                    />
                  </div>
                </div>

                <div>
                  <input
                    ref={logoFileInputRef}
                    type="file"
                    accept=".png,.jpg,.jpeg,.svg,.webp"
                    onChange={handleSelectLogoFile}
                    className="hidden"
                  />

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => logoFileInputRef.current?.click()}
                      className="btn-shimmer inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#2B2B2B] hover:bg-[#3D3D3D] text-white text-xs font-bold active:scale-[0.98] cursor-pointer"
                    >
                      <Upload className="w-3.5 h-3.5 text-[#C5A044]" />
                      <span>Chọn ảnh Logo từ máy</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setLogoPreview(DEFAULT_LOGO_PATH);
                        setSelectedLogoFile(null);
                        localStorage.removeItem("allsoft_custom_logo");
                      }}
                      className="px-3 py-2 rounded-xl bg-[#FBF7EC] text-[#8A6D23] border border-[#EAE2CE] text-xs font-bold hover:bg-[#F3E9CE] active:scale-[0.98] cursor-pointer"
                    >
                      Logo gốc
                    </button>

                    {selectedLogoFile && (
                      <span className="text-[11px] font-semibold text-emerald-700 truncate max-w-[180px]">
                        ✓ {selectedLogoFile.name}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Khung Icon phần mềm / Favicon */}
              <div className="p-5 rounded-2xl bg-[#FDFBF7] border-2 border-dashed border-[#C5A044]/60 flex flex-col justify-between gap-4">
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <h4 className="text-sm font-extrabold text-[#2D2D2D] flex items-center gap-1.5">
                      <Globe className="w-4 h-4 text-[#B5943B]" />
                      <span>Icon phần mềm / Favicon trình duyệt</span>
                    </h4>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-white border border-[#EAE2CE] text-[#8A6D23]">
                      PNG / ICO / SVG
                    </span>
                  </div>
                  <p className="text-[11px] text-[#5C5649] mb-4">
                    Tự động cập nhật biểu tượng trên tab trình duyệt (Favicon) và đồng bộ về kho tài nguyên phần mềm.
                  </p>

                  <div className="w-full min-h-[108px] py-4 px-4 rounded-xl bg-white border border-[#EAE2CE] flex flex-col sm:flex-row items-center justify-center gap-5 shadow-2xs">
                    <div className="w-16 h-16 rounded-2xl bg-[#FDFBF7] border border-[#EAE2CE] flex items-center justify-center p-2 shadow-xs shrink-0">
                      <img
                        src={iconPreview}
                        alt="Xem trước Icon phần mềm"
                        className="w-12 h-12 object-contain"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).src = DEFAULT_ICON_PATH;
                        }}
                      />
                    </div>
                    <div className="flex items-center gap-2 px-3 py-2 rounded-t-xl rounded-b-lg bg-[#FDFBF7] border border-[#EAE2CE] text-xs font-semibold text-[#2D2D2D] shadow-2xs">
                      <img
                        src={iconPreview}
                        alt="Favicon preview"
                        className="w-4 h-4 object-contain shrink-0"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).src = DEFAULT_ICON_PATH;
                        }}
                      />
                      <span className="truncate max-w-[160px]">{brandingState.app_name || "AllSoft Desktop"}</span>
                    </div>
                  </div>
                </div>

                <div>
                  <input
                    ref={iconFileInputRef}
                    type="file"
                    accept=".png,.ico,.svg,.jpg,.jpeg,.webp"
                    onChange={handleSelectIconFile}
                    className="hidden"
                  />

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => iconFileInputRef.current?.click()}
                      className="btn-shimmer inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#2B2B2B] hover:bg-[#3D3D3D] text-white text-xs font-bold active:scale-[0.98] cursor-pointer"
                    >
                      <Upload className="w-3.5 h-3.5 text-[#C5A044]" />
                      <span>Chọn ảnh Icon / Favicon</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setIconPreview(DEFAULT_ICON_PATH);
                        setSelectedIconFile(null);
                        localStorage.removeItem("allsoft_custom_icon");
                      }}
                      className="px-3 py-2 rounded-xl bg-[#FBF7EC] text-[#8A6D23] border border-[#EAE2CE] text-xs font-bold hover:bg-[#F3E9CE] active:scale-[0.98] cursor-pointer"
                    >
                      Icon gốc
                    </button>

                    {selectedIconFile && (
                      <span className="text-[11px] font-semibold text-emerald-700 truncate max-w-[180px]">
                        ✓ {selectedIconFile.name}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Tên hệ thống & Dòng bản quyền chân trang */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-[#EAE2CE]">
              <div>
                <label className="block text-xs font-bold text-[#2D2D2D] mb-1">
                  Tên hệ thống (<code>app_name</code>)
                </label>
                <input
                  type="text"
                  value={brandingState.app_name}
                  onChange={(e) => setBrandingState({ ...brandingState, app_name: e.target.value })}
                  placeholder="AllSoft Desktop"
                  className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-[#EAE2CE] bg-[#FDFBF7] text-[#2D2D2D] focus:border-[#B5943B] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#2D2D2D] mb-1">
                  Dòng bản quyền chân trang (<code>footer_copyright</code>)
                </label>
                <input
                  type="text"
                  value={siteContentState.footer_copyright}
                  onChange={(e) => updateSiteField("footer_copyright", e.target.value)}
                  placeholder="© 2026 AllSoft Desktop · Created By Mr. Dương"
                  className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-[#EAE2CE] bg-[#FDFBF7] text-[#2D2D2D] focus:border-[#B5943B] focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* NHÓM 2: NHÃN NÚT THANH ĐIỀU HƯỚNG (HEADER MENU) */}
          <div className="card-spotlight rounded-2xl p-6 space-y-4">
            <div className="pb-3 border-b border-[#EAE2CE]">
              <div className="inline-flex items-center gap-1.5 text-[11px] font-extrabold text-[#8A6D23] uppercase tracking-wider mb-0.5">
                <Navigation className="w-3.5 h-3.5 text-[#B5943B]" />
                <span>NHÓM 2 · THANH ĐIỀU HƯỚNG</span>
              </div>
              <h3 className="text-base sm:text-lg font-extrabold text-[#2D2D2D]">
                Nhãn nút Thanh điều hướng (Header &amp; Footer Menu)
              </h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-bold text-[#2D2D2D] mb-1">
                  Nút 1 · Trang chủ (<code>nav_apps</code>)
                </label>
                <input
                  type="text"
                  value={siteContentState.nav_apps}
                  onChange={(e) => updateSiteField("nav_apps", e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-[#EAE2CE] bg-[#FDFBF7] text-[#2D2D2D] focus:border-[#B5943B] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#2D2D2D] mb-1">
                  Nút 2 · Tài liệu (<code>nav_docs</code>)
                </label>
                <input
                  type="text"
                  value={siteContentState.nav_docs}
                  onChange={(e) => updateSiteField("nav_docs", e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-[#EAE2CE] bg-[#FDFBF7] text-[#2D2D2D] focus:border-[#B5943B] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#2D2D2D] mb-1">
                  Nút 3 · Nhật ký (<code>nav_changelog</code>)
                </label>
                <input
                  type="text"
                  value={siteContentState.nav_changelog}
                  onChange={(e) => updateSiteField("nav_changelog", e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-[#EAE2CE] bg-[#FDFBF7] text-[#2D2D2D] focus:border-[#B5943B] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#2D2D2D] mb-1">
                  Nút 4 · Quản trị (<code>nav_admin</code>)
                </label>
                <input
                  type="text"
                  value={siteContentState.nav_admin}
                  onChange={(e) => updateSiteField("nav_admin", e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-[#EAE2CE] bg-[#FDFBF7] text-[#2D2D2D] focus:border-[#B5943B] focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* NHÓM 3: VÙNG HERO, NÚT TẢI & HỘP POWERSHELL */}
          <div className="card-spotlight rounded-2xl p-6 space-y-5">
            <div className="pb-3 border-b border-[#EAE2CE]">
              <div className="inline-flex items-center gap-1.5 text-[11px] font-extrabold text-[#8A6D23] uppercase tracking-wider mb-0.5">
                <Type className="w-3.5 h-3.5 text-[#B5943B]" />
                <span>NHÓM 3 · ĐẦU TRANG &amp; TẢI XUỐNG</span>
              </div>
              <h3 className="text-base sm:text-lg font-extrabold text-[#2D2D2D]">
                Vùng Hero, Nút tải &amp; Hộp lệnh PowerShell
              </h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-bold text-[#2D2D2D] mb-1">
                  Nhãn nổi trên cùng (<code>hero_badge</code>)
                </label>
                <input
                  type="text"
                  value={siteContentState.hero_badge}
                  onChange={(e) => updateSiteField("hero_badge", e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-[#EAE2CE] bg-[#FDFBF7] text-[#2D2D2D] focus:border-[#B5943B] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#2D2D2D] mb-1">
                  Tiêu đề chính Hero (<code>hero_title</code>)
                </label>
                <input
                  type="text"
                  value={siteContentState.hero_title}
                  onChange={(e) => updateSiteField("hero_title", e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-[#EAE2CE] bg-[#FDFBF7] text-[#2D2D2D] focus:border-[#B5943B] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#2D2D2D] mb-1">
                  Dòng nhấn Vàng Đồng (<code>hero_highlight</code>)
                </label>
                <input
                  type="text"
                  value={siteContentState.hero_highlight}
                  onChange={(e) => updateSiteField("hero_highlight", e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-[#EAE2CE] bg-[#FDFBF7] text-[#2D2D2D] focus:border-[#B5943B] focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-[#2D2D2D] mb-1">
                Mô tả phụ Trang chủ (<code>hero_subtitle</code>)
              </label>
              <textarea
                rows={2}
                value={siteContentState.hero_subtitle}
                onChange={(e) => updateSiteField("hero_subtitle", e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-[#EAE2CE] bg-[#FDFBF7] text-[#2D2D2D] focus:border-[#B5943B] focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t border-[#EAE2CE]">
              <div>
                <label className="block text-xs font-bold text-[#2D2D2D] mb-1">
                  Chữ Nút tải chính (<code>btn_download_primary</code>)
                </label>
                <input
                  type="text"
                  value={siteContentState.btn_download_primary}
                  onChange={(e) => updateSiteField("btn_download_primary", e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-[#EAE2CE] bg-[#FDFBF7] text-[#2D2D2D] focus:border-[#B5943B] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#2D2D2D] mb-1">
                  Chữ Nút bản Portable (<code>btn_download_portable</code>)
                </label>
                <input
                  type="text"
                  value={siteContentState.btn_download_portable}
                  onChange={(e) => updateSiteField("btn_download_portable", e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-[#EAE2CE] bg-[#FDFBF7] text-[#2D2D2D] focus:border-[#B5943B] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#2D2D2D] mb-1">
                  Ghi chú phiên bản dưới nút (<code>hero_version_note</code>)
                </label>
                <input
                  type="text"
                  value={siteContentState.hero_version_note}
                  onChange={(e) => updateSiteField("hero_version_note", e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-[#EAE2CE] bg-[#FDFBF7] text-[#2D2D2D] focus:border-[#B5943B] focus:outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t border-[#EAE2CE]">
              <div>
                <label className="block text-xs font-bold text-[#2D2D2D] mb-1">
                  Tiêu đề hộp PowerShell (<code>ps_title</code>)
                </label>
                <input
                  type="text"
                  value={siteContentState.ps_title}
                  onChange={(e) => updateSiteField("ps_title", e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-[#EAE2CE] bg-[#FDFBF7] text-[#2D2D2D] focus:border-[#B5943B] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#2D2D2D] mb-1">
                  Ghi chú dưới lệnh (<code>ps_note</code>)
                </label>
                <input
                  type="text"
                  value={siteContentState.ps_note}
                  onChange={(e) => updateSiteField("ps_note", e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-[#EAE2CE] bg-[#FDFBF7] text-[#2D2D2D] focus:border-[#B5943B] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#2D2D2D] mb-1">
                  Link Quản trị nhanh (<code>ps_admin_link</code>)
                </label>
                <input
                  type="text"
                  value={siteContentState.ps_admin_link}
                  onChange={(e) => updateSiteField("ps_admin_link", e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-[#EAE2CE] bg-[#FDFBF7] text-[#2D2D2D] focus:border-[#B5943B] focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* NHÓM 4: TIÊU ĐỀ BODY & CHÂN TRANG (FOOTER) */}
          <div className="card-spotlight rounded-2xl p-6 space-y-5">
            <div className="pb-3 border-b border-[#EAE2CE]">
              <div className="inline-flex items-center gap-1.5 text-[11px] font-extrabold text-[#8A6D23] uppercase tracking-wider mb-0.5">
                <FileText className="w-3.5 h-3.5 text-[#B5943B]" />
                <span>NHÓM 4 · NỘI DUNG TRANG &amp; CHÂN TRANG</span>
              </div>
              <h3 className="text-base sm:text-lg font-extrabold text-[#2D2D2D]">
                Tiêu đề Mục Hồ sơ, Kho Phần mềm &amp; Chân trang (Footer)
              </h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-bold text-[#2D2D2D] mb-1">
                  Nhãn trên mục Profiles (<code>profiles_eyebrow</code>)
                </label>
                <input
                  type="text"
                  value={siteContentState.profiles_eyebrow}
                  onChange={(e) => updateSiteField("profiles_eyebrow", e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-[#EAE2CE] bg-[#FDFBF7] text-[#2D2D2D] focus:border-[#B5943B] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#2D2D2D] mb-1">
                  Tiêu đề mục Profiles (<code>profiles_title</code>)
                </label>
                <input
                  type="text"
                  value={siteContentState.profiles_title}
                  onChange={(e) => updateSiteField("profiles_title", e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-[#EAE2CE] bg-[#FDFBF7] text-[#2D2D2D] focus:border-[#B5943B] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#2D2D2D] mb-1">
                  Mô tả mục Profiles (<code>profiles_subtitle</code>)
                </label>
                <input
                  type="text"
                  value={siteContentState.profiles_subtitle}
                  onChange={(e) => updateSiteField("profiles_subtitle", e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-[#EAE2CE] bg-[#FDFBF7] text-[#2D2D2D] focus:border-[#B5943B] focus:outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t border-[#EAE2CE]">
              <div>
                <label className="block text-xs font-bold text-[#2D2D2D] mb-1">
                  Nhãn trên mục Catalog (<code>catalog_eyebrow</code>)
                </label>
                <input
                  type="text"
                  value={siteContentState.catalog_eyebrow}
                  onChange={(e) => updateSiteField("catalog_eyebrow", e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-[#EAE2CE] bg-[#FDFBF7] text-[#2D2D2D] focus:border-[#B5943B] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#2D2D2D] mb-1">
                  Tiêu đề Danh mục (<code>catalog_title</code>)
                </label>
                <input
                  type="text"
                  value={siteContentState.catalog_title}
                  onChange={(e) => updateSiteField("catalog_title", e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-[#EAE2CE] bg-[#FDFBF7] text-[#2D2D2D] focus:border-[#B5943B] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#2D2D2D] mb-1">
                  Gợi ý ô tìm kiếm (<code>catalog_search_placeholder</code>)
                </label>
                <input
                  type="text"
                  value={siteContentState.catalog_search_placeholder}
                  onChange={(e) => updateSiteField("catalog_search_placeholder", e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-[#EAE2CE] bg-[#FDFBF7] text-[#2D2D2D] focus:border-[#B5943B] focus:outline-none"
                />
              </div>
            </div>

            <div className="space-y-4 pt-2 border-t border-[#EAE2CE]">
              <div>
                <label className="block text-xs font-bold text-[#2D2D2D] mb-1">
                  Mô tả hệ thống dưới Logo chân trang (<code>footer_desc</code>)
                </label>
                <textarea
                  rows={2}
                  value={siteContentState.footer_desc}
                  onChange={(e) => updateSiteField("footer_desc", e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-[#EAE2CE] bg-[#FDFBF7] text-[#2D2D2D] focus:border-[#B5943B] focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-[#2D2D2D] mb-1">
                    Tiêu đề cột Điều hướng Footer (<code>footer_nav_title</code>)
                  </label>
                  <input
                    type="text"
                    value={siteContentState.footer_nav_title}
                    onChange={(e) => updateSiteField("footer_nav_title", e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-[#EAE2CE] bg-[#FDFBF7] text-[#2D2D2D] focus:border-[#B5943B] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#2D2D2D] mb-1">
                    Tiêu đề cột Hạ tầng Footer (<code>footer_infra_title</code>)
                  </label>
                  <input
                    type="text"
                    value={siteContentState.footer_infra_title}
                    onChange={(e) => updateSiteField("footer_infra_title", e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-[#EAE2CE] bg-[#FDFBF7] text-[#2D2D2D] focus:border-[#B5943B] focus:outline-none"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* THANH HÀNH ĐỘNG CUỐI FORM */}
          <div className="card-spotlight rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-[#FDFBF7]">
            <button
              type="button"
              onClick={handleResetSiteText}
              className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-white hover:bg-[#FBF7EC] text-[#5C5649] hover:text-[#8A6D23] border border-[#EAE2CE] text-xs sm:text-sm font-bold active:scale-[0.98] transition-all cursor-pointer"
            >
              <RotateCcw className="w-4 h-4 text-[#B5943B]" />
              <span>Khôi phục văn bản gốc</span>
            </button>

            <button
              type="submit"
              disabled={savingCms}
              className="btn-shimmer inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-[#C5A044] to-[#9A7B2C] text-white text-xs sm:text-sm font-bold shadow-md shadow-[#B5943B]/25 active:scale-[0.98] disabled:opacity-60 cursor-pointer"
            >
              {savingCms ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              <span>
                {savingCms
                  ? "Đang lưu & đồng bộ..."
                  : "Lưu toàn bộ Giao diện & Đồng bộ ngay"}
              </span>
            </button>
          </div>
        </form>
      )}

      {/* ==================== NỘI DUNG TAB 4: XUẤT BẢN, SAO LƯU & ĐỔI MẬT KHẨU ==================== */}
      {activeTab === "publish" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 animate-fade-up">
          <div className="lg:col-span-7 space-y-6">
            <div className="card-spotlight rounded-2xl p-6 space-y-4">
              <h3 className="text-base font-extrabold text-[#2D2D2D] flex items-center gap-2">
                <Save className="w-4 h-4 text-[#B5943B]" />
                <span>Lưu Hệ thống & Quản lý Tệp Danh mục (apps.json)</span>
              </h3>
              <p className="text-xs text-[#5C5649]">
                Lưu trực tiếp vào tệp <code>catalog/apps.json</code> hoặc xuất/nhập tệp cấu hình để sao lưu.
              </p>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={handleSaveToSystem}
                  disabled={savingSystem}
                  className="btn-shimmer inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#C5A044] to-[#9A7B2C] text-white text-xs font-bold shadow-sm active:scale-[0.98] cursor-pointer"
                >
                  <Save className="w-4 h-4" />
                  <span>Lưu trực tiếp vào Hệ thống</span>
                </button>

                <button
                  type="button"
                  onClick={handleExportAppsJson}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#2B2B2B] hover:bg-[#3D3D3D] text-white text-xs font-bold active:scale-[0.98] cursor-pointer"
                >
                  <Download className="w-4 h-4 text-[#C5A044]" />
                  <span>Xuất file apps.json</span>
                </button>

                <input
                  ref={fileInputImportRef}
                  type="file"
                  accept=".json"
                  onChange={handleImportAppsJson}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputImportRef.current?.click()}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#FBF7EC] hover:bg-[#F3E9CE] text-[#8A6D23] border border-[#EAE2CE] text-xs font-bold active:scale-[0.98] cursor-pointer"
                >
                  <Upload className="w-4 h-4 text-[#B5943B]" />
                  <span>Nhập file apps.json</span>
                </button>

                <button
                  type="button"
                  onClick={handleResetDefault}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-bold active:scale-[0.98] cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>Khôi phục mặc định</span>
                </button>
              </div>
            </div>

            <form onSubmit={handleGitHubCloudSync} className="card-spotlight rounded-2xl p-6 space-y-4">
              <h3 className="text-base font-extrabold text-[#2D2D2D] flex items-center gap-2">
                <CloudUpload className="w-4 h-4 text-[#B5943B]" />
                <span>Xuất bản lên GitHub (Cloud Sync)</span>
              </h3>
              <p className="text-xs text-[#5C5649]">
                Đẩy thẳng danh mục <code>catalog/apps.json</code> lên GitHub qua REST API và mở khóa tính năng Upload bộ cài lên GitHub Releases trong Modal Thêm phần mềm.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-[#2D2D2D] mb-1">
                    GitHub Repository (owner/repo)
                  </label>
                  <input
                    type="text"
                    value={ghRepo}
                    onChange={(e) => setGhRepo(e.target.value)}
                    placeholder="ntdtdt2010-bit/AllSoftDesktop"
                    className="w-full px-3.5 py-2 text-xs sm:text-sm rounded-xl border border-[#EAE2CE] bg-[#FDFBF7] text-[#2D2D2D] focus:border-[#B5943B] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#2D2D2D] mb-1">
                    Nhánh (Branch)
                  </label>
                  <input
                    type="text"
                    value={ghBranch}
                    onChange={(e) => setGhBranch(e.target.value)}
                    placeholder="main"
                    className="w-full px-3.5 py-2 text-xs sm:text-sm rounded-xl border border-[#EAE2CE] bg-[#FDFBF7] text-[#2D2D2D] focus:border-[#B5943B] focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#2D2D2D] mb-1">
                  GitHub Personal Access Token (quyền repo / contents:write)
                </label>
                <input
                  type="password"
                  value={ghToken}
                  onChange={(e) => setGhToken(e.target.value)}
                  placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  className="w-full px-3.5 py-2 text-xs sm:text-sm rounded-xl border border-[#EAE2CE] bg-[#FDFBF7] text-[#2D2D2D] focus:border-[#B5943B] focus:outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={ghSyncing}
                className="btn-shimmer inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#2B2B2B] hover:bg-[#3D3D3D] disabled:opacity-50 text-white text-xs font-bold active:scale-[0.98] cursor-pointer"
              >
                <CloudUpload className="w-4 h-4 text-[#C5A044]" />
                <span>{ghSyncing ? "Đang đồng bộ lên GitHub..." : "Xuất bản lên GitHub (Cloud Sync)"}</span>
              </button>
            </form>
          </div>

          <div className="lg:col-span-5">
            <form onSubmit={handleChangeAdminPassword} className="card-spotlight rounded-2xl p-6 space-y-4">
              <h3 className="text-base font-extrabold text-[#2D2D2D] flex items-center gap-2 pb-3 border-b border-[#EAE2CE]">
                <KeyRound className="w-4 h-4 text-[#B5943B]" />
                <span>🔑 Đổi mật khẩu Quản trị viên</span>
              </h3>

              <div>
                <label className="block text-xs font-bold text-[#2D2D2D] mb-1">
                  Mật khẩu hiện tại
                </label>
                <input
                  type="password"
                  value={currentPassInput}
                  onChange={(e) => setCurrentPassInput(e.target.value)}
                  placeholder="Nhập mật khẩu hiện tại..."
                  className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-[#EAE2CE] bg-[#FDFBF7] text-[#2D2D2D] focus:border-[#B5943B] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#2D2D2D] mb-1">
                  Mật khẩu mới
                </label>
                <input
                  type="password"
                  value={newPassInput}
                  onChange={(e) => setNewPassInput(e.target.value)}
                  placeholder="Nhập mật khẩu mới..."
                  className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-[#EAE2CE] bg-[#FDFBF7] text-[#2D2D2D] focus:border-[#B5943B] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#2D2D2D] mb-1">
                  Xác nhận mật khẩu mới
                </label>
                <input
                  type="password"
                  value={confirmPassInput}
                  onChange={(e) => setConfirmPassInput(e.target.value)}
                  placeholder="Nhập lại mật khẩu mới..."
                  className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-[#EAE2CE] bg-[#FDFBF7] text-[#2D2D2D] focus:border-[#B5943B] focus:outline-none"
                />
              </div>

              <button
                type="submit"
                className="btn-shimmer w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-[#C5A044] to-[#9A7B2C] text-white text-xs font-bold shadow-sm active:scale-[0.98] cursor-pointer"
              >
                Cập nhật Mật khẩu Quản trị
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ==================== MODAL KHO 25+ PHẦN MỀM MẪU 1-CLICK ==================== */}
      {showPresetModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 modal-backdrop-luxury"
          onClick={() => setShowPresetModal(false)}
        >
          <div
            className="modal-spring w-full max-w-4xl max-h-[85vh] rounded-3xl bg-white border border-[#EAE2CE] shadow-2xl flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 sm:p-6 border-b border-[#EAE2CE] bg-[#FDFBF7] flex items-center justify-between gap-4">
              <div>
                <div className="inline-flex items-center gap-1.5 text-xs font-bold text-[#8A6D23] mb-1">
                  <Zap className="w-3.5 h-3.5 text-[#B5943B]" />
                  <span>1-CLICK PRESET LIBRARY</span>
                </div>
                <h3 className="text-lg sm:text-xl font-extrabold text-[#2D2D2D]">
                  ⚡ Kho 25+ Phần mềm Thông dụng tại Việt Nam
                </h3>
              </div>

              <button
                type="button"
                onClick={() => setShowPresetModal(false)}
                className="p-2 rounded-xl text-[#5C5649] hover:text-[#2D2D2D] hover:bg-[#FBF7EC] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 border-b border-[#EAE2CE] bg-white">
              <div className="relative">
                <Search className="w-4 h-4 text-[#8A6D23] absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={presetSearch}
                  onChange={(e) => setPresetSearch(e.target.value)}
                  placeholder="Tìm nhanh trong kho 25+ phần mềm mẫu (Zalo, Chrome, Unikey, EVKey, Canon, HIS...)"
                  className="w-full pl-10 pr-4 py-2 text-xs sm:text-sm rounded-xl border border-[#EAE2CE] bg-[#FDFBF7] text-[#2D2D2D] focus:border-[#B5943B] focus:outline-none"
                />
              </div>
            </div>

            <div className="p-5 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {PRESET_VN_APPS.filter((p) => {
                if (!presetSearch.trim()) return true;
                const q = presetSearch.toLowerCase();
                return (
                  p.name.toLowerCase().includes(q) ||
                  p.category.toLowerCase().includes(q) ||
                  (p.winget?.id && p.winget.id.toLowerCase().includes(q))
                );
              }).map((preset) => {
                const alreadyAdded = catalogState.apps.some((a) => a.id === preset.id);
                return (
                  <div
                    key={preset.id}
                    className="p-4 rounded-2xl border border-[#EAE2CE] bg-[#FDFBF7] hover:border-[#C5A044] flex items-center justify-between gap-3 transition-all"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-extrabold text-sm text-[#2D2D2D]">
                          {preset.name}
                        </h4>
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#FBF7EC] text-[#8A6D23] border border-[#EAE2CE]">
                          {preset.category}
                        </span>
                      </div>
                      <p className="text-[11px] text-[#5C5649] mt-0.5 line-clamp-1">
                        {preset.description}
                      </p>
                      <span className="text-[10px] font-mono text-[#8A6D23]">
                        {preset.source === "winget" ? `winget: ${preset.winget?.id}` : "Direct Installer (.exe)"}
                      </span>
                    </div>

                    <button
                      type="button"
                      disabled={alreadyAdded}
                      onClick={() => handleAddPresetApp(preset)}
                      className={`px-3.5 py-2 rounded-xl text-xs font-bold shrink-0 cursor-pointer active:scale-[0.98] transition-all ${
                        alreadyAdded
                          ? "bg-emerald-50 text-emerald-700 border border-emerald-200 cursor-default"
                          : "btn-shimmer bg-gradient-to-r from-[#C5A044] to-[#9A7B2C] text-white shadow-xs"
                      }`}
                    >
                      {alreadyAdded ? (
                        <span className="inline-flex items-center gap-1">
                          <Check className="w-3.5 h-3.5" /> Đã có
                        </span>
                      ) : (
                        "+ Thêm ngay"
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ==================== MODAL THÊM / SỬA PHẦN MỀM ==================== */}
      {editingApp && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 modal-backdrop-luxury"
          onClick={() => {
            setEditingApp(null);
            resetInstallerUploadState();
          }}
        >
          <form
            onSubmit={handleSaveAppModal}
            className="modal-spring w-full max-w-2xl rounded-3xl bg-white border border-[#EAE2CE] p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-[#EAE2CE]">
              <div>
                <h3 className="text-lg font-extrabold text-[#2D2D2D]">
                  {isNewApp ? "Thêm Phần mềm Mới" : `Chỉnh sửa: ${editingApp.name}`}
                </h3>
                <p className="text-[11px] text-[#5C5649]">
                  Hỗ trợ cài tự động từ Winget hoặc Upload trực tiếp bộ cài riêng (.exe / .msi / .zip)
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setEditingApp(null);
                  resetInstallerUploadState();
                }}
                className="p-1.5 rounded-lg text-[#5C5649] hover:text-[#2D2D2D] hover:bg-[#FBF7EC] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-xs font-bold text-[#2D2D2D] mb-1">
                  Tên phần mềm *
                </label>
                <input
                  type="text"
                  required
                  value={editingApp.name}
                  onChange={(e) => setEditingApp({ ...editingApp, name: e.target.value })}
                  placeholder="Ví dụ: Zalo PC hoặc Phần mềm HIS"
                  className="w-full px-3.5 py-2 text-xs sm:text-sm rounded-xl border border-[#EAE2CE] bg-[#FDFBF7] focus:border-[#B5943B] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#2D2D2D] mb-1">
                  Mã ID (tự sinh nếu để trống)
                </label>
                <input
                  type="text"
                  disabled={!isNewApp}
                  value={editingApp.id}
                  onChange={(e) => setEditingApp({ ...editingApp, id: e.target.value })}
                  placeholder="zalo-pc"
                  className="w-full px-3.5 py-2 text-xs sm:text-sm rounded-xl border border-[#EAE2CE] bg-[#FDFBF7] disabled:opacity-60 focus:border-[#B5943B] focus:outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-xs font-bold text-[#2D2D2D] mb-1">
                  Danh mục (Category)
                </label>
                <input
                  type="text"
                  value={editingApp.category}
                  onChange={(e) => setEditingApp({ ...editingApp, category: e.target.value })}
                  placeholder="Trình duyệt, Văn phòng, Y tế, Chữ ký số..."
                  className="w-full px-3.5 py-2 text-xs sm:text-sm rounded-xl border border-[#EAE2CE] bg-[#FDFBF7] focus:border-[#B5943B] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#2D2D2D] mb-1">
                  Nguồn cài đặt (Source)
                </label>
                <select
                  value={editingApp.source}
                  onChange={(e) => {
                    const nextSource = e.target.value as "winget" | "direct";
                    setEditingApp({
                      ...editingApp,
                      source: nextSource,
                      version: nextSource === "winget" ? "latest" : editingApp.version || "1.0.0",
                    });
                  }}
                  className="w-full px-3.5 py-2 text-xs sm:text-sm rounded-xl border border-[#EAE2CE] bg-[#FDFBF7] focus:border-[#B5943B] focus:outline-none"
                >
                  <option value="winget">Winget (Kho chính thức Microsoft)</option>
                  <option value="direct">Direct (Bộ cài riêng .exe / .msi / .zip)</option>
                </select>
              </div>
            </div>

            {/* Hộp giải thích trực quan & cấu hình theo từng Source */}
            {editingApp.source === "winget" ? (
              <div className="space-y-3">
                <div className="p-3.5 rounded-2xl bg-[#FBF7EC] border border-[#EAE2CE] flex items-start gap-2.5 text-xs text-[#8A6D23] leading-relaxed">
                  <Info className="w-4 h-4 text-[#B5943B] shrink-0 mt-0.5" />
                  <span>
                    Desktop Launcher sẽ tự động tải &amp; cài bản mới nhất trực tiếp từ kho{" "}
                    <strong>Microsoft Winget</strong> thông qua Mã Winget ID (không cần upload file bộ cài).
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-bold text-[#2D2D2D] mb-1">
                      Mã Winget ID (ví dụ: VNG.Zalo, Google.Chrome)
                    </label>
                    <input
                      type="text"
                      value={editingApp.winget?.id || ""}
                      onChange={(e) =>
                        setEditingApp({
                          ...editingApp,
                          winget: { id: e.target.value, scope: editingApp.winget?.scope || "machine" },
                        })
                      }
                      placeholder="Google.Chrome"
                      className="w-full px-3.5 py-2 text-xs sm:text-sm rounded-xl border border-[#EAE2CE] bg-[#FDFBF7] focus:border-[#B5943B] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-[#2D2D2D] mb-1">
                      Phạm vi cài (Scope)
                    </label>
                    <select
                      value={editingApp.winget?.scope || "machine"}
                      onChange={(e) =>
                        setEditingApp({
                          ...editingApp,
                          winget: { id: editingApp.winget?.id || "", scope: e.target.value },
                        })
                      }
                      className="w-full px-3.5 py-2 text-xs sm:text-sm rounded-xl border border-[#EAE2CE] bg-[#FDFBF7] focus:border-[#B5943B] focus:outline-none"
                    >
                      <option value="machine">Machine (Toàn máy)</option>
                      <option value="user">User (Người dùng)</option>
                    </select>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Khu vực Kéo-Thả / Chọn tệp Upload bộ cài */}
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragOver(true);
                  }}
                  onDragLeave={() => setIsDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsDragOver(false);
                    const file = e.dataTransfer.files?.[0];
                    if (file) {
                      void handleInstallerFileProcess(file);
                    }
                  }}
                  className={`p-5 rounded-2xl border-2 border-dashed transition-all text-center ${
                    isDragOver
                      ? "border-[#B5943B] bg-[#FBF7EC]"
                      : "border-[#C5A044]/60 bg-[#FDFBF7] hover:border-[#B5943B]"
                  }`}
                >
                  <input
                    ref={installerFileInputRef}
                    type="file"
                    accept=".exe,.msi,.zip,.7z"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        void handleInstallerFileProcess(file);
                      }
                      e.target.value = "";
                    }}
                    className="hidden"
                  />

                  <div className="flex flex-col items-center gap-2">
                    <div className="w-11 h-11 rounded-2xl bg-[#FBF7EC] border border-[#EAE2CE] flex items-center justify-center">
                      {uploadingInstaller ? (
                        <Loader2 className="w-5 h-5 text-[#B5943B] animate-spin" />
                      ) : (
                        <FileArchive className="w-5 h-5 text-[#B5943B]" />
                      )}
                    </div>

                    <div className="text-xs sm:text-sm font-bold text-[#2D2D2D]">
                      {uploadingInstaller
                        ? "Đang tính SHA-256 & lưu bộ cài vào thư mục packages/..."
                        : "Kéo thả bộ cài (.exe, .msi, .zip, .7z) vào đây hoặc bấm chọn tệp"}
                    </div>

                    <p className="text-[11px] text-[#5C5649] max-w-md">
                      Hệ thống tự động tính mã kiểm toàn vẹn <strong>SHA-256</strong>, nhận diện loại bộ cài, gợi ý tham số cài ngầm và lưu trực tiếp vào <code>packages/</code> (khi chạy local).
                    </p>

                    <div className="flex flex-wrap items-center justify-center gap-2 mt-1">
                      <button
                        type="button"
                        disabled={uploadingInstaller}
                        onClick={() => installerFileInputRef.current?.click()}
                        className="btn-shimmer inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#2B2B2B] hover:bg-[#3D3D3D] text-white text-xs font-bold active:scale-[0.98] cursor-pointer disabled:opacity-60"
                      >
                        <Upload className="w-3.5 h-3.5 text-[#C5A044]" />
                        <span>Chọn tệp bộ cài từ máy</span>
                      </button>

                      {installerStatus?.mode === "pending" && pendingInstallerFile && ghToken.trim() && (
                        <button
                          type="button"
                          disabled={uploadingGitHubRelease}
                          onClick={() => void handleUploadInstallerToGitHubRelease()}
                          className="btn-shimmer inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-[#C5A044] to-[#9A7B2C] text-white text-xs font-bold active:scale-[0.98] cursor-pointer disabled:opacity-60"
                        >
                          {uploadingGitHubRelease ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <CloudUpload className="w-3.5 h-3.5" />
                          )}
                          <span>
                            {uploadingGitHubRelease
                              ? "Đang đẩy lên GitHub Releases..."
                              : "Upload lên GitHub Releases"}
                          </span>
                        </button>
                      )}
                    </div>
                  </div>

                  {installerStatus && (
                    <div className="mt-4 p-3 rounded-xl bg-white border border-[#EAE2CE] text-left flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                      <div className="flex items-start gap-2 min-w-0">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                        <div className="min-w-0">
                          <div className="font-bold text-[#2D2D2D] truncate">
                            {installerStatus.fileName}{" "}
                            <span className="font-normal text-[#5C5649]">
                              ({installerStatus.sizeMB} MB)
                            </span>
                          </div>
                          <div className="text-[11px] font-mono text-[#8A6D23] truncate">
                            SHA-256: {installerStatus.sha256.slice(0, 16)}…{installerStatus.sha256.slice(-8)}
                          </div>
                        </div>
                      </div>
                      <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-[#FBF7EC] text-[#8A6D23] border border-[#EAE2CE] shrink-0 self-start sm:self-center">
                        {installerStatus.mode === "local"
                          ? "Đã lưu vào packages/"
                          : installerStatus.mode === "github"
                          ? "Đã đẩy lên GitHub Releases"
                          : "Đã tính SHA-256"}
                      </span>
                    </div>
                  )}
                </div>

                {/* Các trường tùy chỉnh Direct */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-bold text-[#2D2D2D] mb-1">
                      Đường dẫn tải trực tiếp (direct.url)
                    </label>
                    <input
                      type="text"
                      value={editingApp.direct?.url || ""}
                      onChange={(e) =>
                        setEditingApp({
                          ...editingApp,
                          direct: {
                            url: e.target.value,
                            installer_type: editingApp.direct?.installer_type || "exe",
                            silent_args: editingApp.direct?.silent_args || ["/S"],
                            sha256: editingApp.direct?.sha256 || null,
                            offline_filename: editingApp.direct?.offline_filename || "",
                          },
                        })
                      }
                      placeholder="https://.../Setup.exe hoặc tự điền sau khi upload"
                      className="w-full px-3.5 py-2 text-xs sm:text-sm rounded-xl border border-[#EAE2CE] bg-[#FDFBF7] focus:border-[#B5943B] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-[#2D2D2D] mb-1">
                      Phiên bản
                    </label>
                    <input
                      type="text"
                      value={editingApp.version}
                      onChange={(e) => setEditingApp({ ...editingApp, version: e.target.value })}
                      placeholder="1.0.0"
                      className="w-full px-3.5 py-2 text-xs sm:text-sm rounded-xl border border-[#EAE2CE] bg-[#FDFBF7] focus:border-[#B5943B] focus:outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-[#2D2D2D] mb-1">
                      Tên file Offline (packages/)
                    </label>
                    <input
                      type="text"
                      value={editingApp.direct?.offline_filename || ""}
                      onChange={(e) =>
                        setEditingApp({
                          ...editingApp,
                          direct: {
                            url: editingApp.direct?.url || "",
                            installer_type: editingApp.direct?.installer_type || "exe",
                            silent_args: editingApp.direct?.silent_args || ["/S"],
                            sha256: editingApp.direct?.sha256 || null,
                            offline_filename: e.target.value,
                          },
                        })
                      }
                      placeholder="Setup.exe"
                      className="w-full px-3.5 py-2 text-xs sm:text-sm rounded-xl border border-[#EAE2CE] bg-[#FDFBF7] focus:border-[#B5943B] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-[#2D2D2D] mb-1">
                      Loại bộ cài
                    </label>
                    <select
                      value={editingApp.direct?.installer_type || "exe"}
                      onChange={(e) => {
                        const nextType = e.target.value;
                        const defaultArgs = nextType === "msi" ? ["/qn", "/norestart"] : ["/S"];
                        setSilentArgsInput(defaultArgs.join(" "));
                        setEditingApp({
                          ...editingApp,
                          direct: {
                            url: editingApp.direct?.url || "",
                            installer_type: nextType,
                            silent_args: defaultArgs,
                            sha256: editingApp.direct?.sha256 || null,
                            offline_filename: editingApp.direct?.offline_filename || "",
                          },
                        });
                      }}
                      className="w-full px-3.5 py-2 text-xs sm:text-sm rounded-xl border border-[#EAE2CE] bg-[#FDFBF7] focus:border-[#B5943B] focus:outline-none"
                    >
                      <option value="exe">.exe (Executable)</option>
                      <option value="msi">.msi (Windows Installer)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-[#2D2D2D] mb-1">
                      Tham số cài ngầm (silent_args)
                    </label>
                    <input
                      type="text"
                      value={silentArgsInput}
                      onChange={(e) => setSilentArgsInput(e.target.value)}
                      placeholder="/S hoặc /qn /norestart"
                      className="w-full px-3.5 py-2 text-xs sm:text-sm font-mono rounded-xl border border-[#EAE2CE] bg-[#FDFBF7] focus:border-[#B5943B] focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#2D2D2D] mb-1">
                    Mã kiểm toàn vẹn SHA-256 (tự động tính khi upload bộ cài)
                  </label>
                  <input
                    type="text"
                    value={editingApp.direct?.sha256 || ""}
                    onChange={(e) =>
                      setEditingApp({
                        ...editingApp,
                        direct: {
                          url: editingApp.direct?.url || "",
                          installer_type: editingApp.direct?.installer_type || "exe",
                          silent_args: editingApp.direct?.silent_args || ["/S"],
                          sha256: e.target.value || null,
                          offline_filename: editingApp.direct?.offline_filename || "",
                        },
                      })
                    }
                    placeholder="Tùy chọn — 64 ký tự hex SHA-256"
                    className="w-full px-3.5 py-2 text-xs font-mono rounded-xl border border-[#EAE2CE] bg-[#FDFBF7] focus:border-[#B5943B] focus:outline-none"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-[#2D2D2D] mb-1">
                Trang chủ / Liên kết tham khảo (changelog_url)
              </label>
              <input
                type="text"
                value={editingApp.changelog_url || ""}
                onChange={(e) => setEditingApp({ ...editingApp, changelog_url: e.target.value })}
                placeholder="https://..."
                className="w-full px-3.5 py-2 text-xs sm:text-sm rounded-xl border border-[#EAE2CE] bg-[#FDFBF7] focus:border-[#B5943B] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-[#2D2D2D] mb-1">
                Mô tả chức năng phần mềm
              </label>
              <textarea
                rows={2}
                value={editingApp.description}
                onChange={(e) => setEditingApp({ ...editingApp, description: e.target.value })}
                placeholder="Mô tả ngắn gọn công dụng phần mềm để hiển thị trên Web Portal..."
                className="w-full px-3.5 py-2 text-xs sm:text-sm rounded-xl border border-[#EAE2CE] bg-[#FDFBF7] focus:border-[#B5943B] focus:outline-none"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#EAE2CE]">
              <button
                type="button"
                onClick={() => {
                  setEditingApp(null);
                  resetInstallerUploadState();
                }}
                className="px-4 py-2 rounded-xl text-xs font-bold text-[#5C5649] hover:bg-[#FBF7EC] active:scale-[0.98] cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="submit"
                className="btn-shimmer px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#C5A044] to-[#9A7B2C] text-white text-xs font-bold shadow-sm active:scale-[0.98] cursor-pointer"
              >
                Lưu Phần mềm
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ==================== MODAL THÊM / SỬA HỒ SƠ MÁY (PROFILES) ==================== */}
      {editingProfile && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 modal-backdrop-luxury"
          onClick={() => setEditingProfile(null)}
        >
          <form
            onSubmit={handleSaveProfileModal}
            className="modal-spring w-full max-w-xl rounded-3xl bg-white border border-[#EAE2CE] p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-[#EAE2CE]">
              <h3 className="text-lg font-extrabold text-[#2D2D2D]">
                {isNewProfile ? "Tạo Hồ sơ Máy trạm Mới" : `Chỉnh sửa Hồ sơ: ${editingProfile.name}`}
              </h3>
              <button
                type="button"
                onClick={() => setEditingProfile(null)}
                className="p-1.5 rounded-lg text-[#5C5649] hover:text-[#2D2D2D] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-[#2D2D2D] mb-1">
                  Tên Hồ sơ (Vị trí / Phòng ban) *
                </label>
                <input
                  type="text"
                  required
                  value={editingProfile.name}
                  onChange={(e) => setEditingProfile({ ...editingProfile, name: e.target.value })}
                  placeholder="Ví dụ: Máy Bác sĩ Khám bệnh"
                  className="w-full px-3 py-2 text-xs sm:text-sm rounded-xl border border-[#EAE2CE] bg-[#FDFBF7]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#2D2D2D] mb-1">
                  Mã Hồ sơ (ID)
                </label>
                <input
                  type="text"
                  disabled={!isNewProfile}
                  value={editingProfile.id}
                  onChange={(e) => setEditingProfile({ ...editingProfile, id: e.target.value })}
                  placeholder="doctor-station"
                  className="w-full px-3 py-2 text-xs sm:text-sm rounded-xl border border-[#EAE2CE] bg-[#FDFBF7] disabled:opacity-60"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-[#2D2D2D] mb-1">
                Mô tả Hồ sơ
              </label>
              <input
                type="text"
                value={editingProfile.description}
                onChange={(e) => setEditingProfile({ ...editingProfile, description: e.target.value })}
                placeholder="Gói phần mềm chuẩn cho phòng khám..."
                className="w-full px-3 py-2 text-xs sm:text-sm rounded-xl border border-[#EAE2CE] bg-[#FDFBF7]"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-[#2D2D2D] mb-2">
                Tích chọn Phần mềm thuộc Hồ sơ ({editingProfile.apps.length} đã chọn)
              </label>
              <div className="max-h-56 overflow-y-auto p-3 rounded-2xl border border-[#EAE2CE] bg-[#FDFBF7] grid grid-cols-1 sm:grid-cols-2 gap-2">
                {catalogState.apps
                  .filter((a) => !a.hidden)
                  .map((app) => {
                    const checked = editingProfile.apps.includes(app.id);
                    return (
                      <label
                        key={app.id}
                        className={`flex items-center gap-2.5 p-2 rounded-xl border cursor-pointer text-xs font-semibold transition-all ${
                          checked
                            ? "bg-[#FBF7EC] border-[#B5943B] text-[#2D2D2D]"
                            : "bg-white border-[#EAE2CE] text-[#5C5649]"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleAppInEditingProfile(app.id)}
                          className="accent-[#B5943B] w-4 h-4 rounded"
                        />
                        <span className="truncate">{app.name}</span>
                      </label>
                    );
                  })}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#EAE2CE]">
              <button
                type="button"
                onClick={() => setEditingProfile(null)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-[#5C5649] hover:bg-[#FBF7EC] active:scale-[0.98] cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="submit"
                className="btn-shimmer px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#C5A044] to-[#9A7B2C] text-white text-xs font-bold active:scale-[0.98] cursor-pointer"
              >
                Lưu Hồ sơ Máy
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
