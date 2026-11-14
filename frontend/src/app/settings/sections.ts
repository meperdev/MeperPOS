import {
  Building2,
  CreditCard,
  Database,
  MessageCircle,
  Receipt,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

export interface SettingsSection {
  key: string;
  label: string;
  href: string;
  icon: LucideIcon;
}

export const settingsSections: SettingsSection[] = [
  {
    key: "general",
    label: "General",
    href: "/settings/general",
    icon: Building2,
  },
  {
    key: "invoicing",
    label: "Facturación y recibos",
    href: "/settings/invoicing",
    icon: Receipt,
  },
  {
    key: "team",
    label: "Equipo y acceso",
    href: "/settings/team",
    icon: UsersRound,
  },
  {
    key: "whatsapp",
    label: "WhatsApp",
    href: "/settings/whatsapp",
    icon: MessageCircle,
  },
  {
    key: "data",
    label: "Importar y exportar datos",
    href: "/settings/data",
    icon: Database,
  },
  {
    key: "billing",
    label: "Suscripción",
    href: "/settings/billing",
    icon: CreditCard,
  },
];
