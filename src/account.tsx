import * as Menu from "@radix-ui/react-dropdown-menu";
import { Check, User } from "lucide-react";
import { useEffect, useState } from "react";
import { themes, useShape, useTheme, type ShapeId, type ThemeId } from "./theme";

type Me = {
  name: string;
  email: string;
  title: string;
  accountId: string;
  roleId: string;
  roleCenter: string;
};

const centers: Record<string, string> = {
  ACCOUNTCENTER: "Accounting",
  BASIC: "Classic",
  MARKETINGCENTER: "Marketing",
  SALESCENTER: "Sales",
  SUPPORTCENTER: "Support",
  SHIPPINGCENTER: "Shipping",
  SYSADMINCENTER: "Administrator",
  PARTNERCENTER: "Partner",
  CUSTOMERCENTER: "Customer",
  VENDORCENTER: "Vendor",
  EMPLOYEECENTER: "Employee",
};

function centerLabel(code: string) {
  if (!code) return "";
  if (centers[code]) return centers[code];
  const words = code.replace(/CENTER$/, "").replace(/_/g, " ").toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "";
}

function initials(name: string) {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return "";
}

export function UserMenu({
  accountId,
  roleId,
  canSignOut,
  onSignOut,
}: {
  accountId: string;
  roleId: string | null;
  canSignOut: boolean;
  onSignOut: () => void;
}) {
  const [me, setMe] = useState<Me | null>(null);
  const [shape, setShape] = useShape();
  const [theme, setTheme] = useTheme();
  const account = me?.accountId || accountId.toUpperCase();
  const role = me?.roleId || roleId || "";
  const center = centerLabel(me?.roleCenter || "");
  const name = me?.name || "";
  const letters = initials(name);

  useEffect(() => {
    let gone = false;
    fetch("/api/me")
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Could not read the signed-in user.");
        return body as Me;
      })
      .then((body) => {
        if (!gone) setMe(body);
      })
      .catch(() => {
        if (!gone) setMe(null);
      });
    return () => {
      gone = true;
    };
  }, []);

  return (
    <Menu.Root>
      <Menu.Trigger className="avatar" aria-label={name ? `${name}, account menu` : "Account menu"}>
        {letters || <User size={16} strokeWidth={1.75} aria-hidden="true" />}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content className="menu-content" side="bottom" align="end" sideOffset={6}>
          <div className="who-card">
            <strong>{name || "Signed in"}</strong>
            {me?.title ? <em>{me.title}</em> : null}
            {me?.email ? <span>{me.email}</span> : null}
            <dl>
              <div>
                <dt>Account</dt>
                <dd>{account}</dd>
              </div>
              {role ? (
                <div>
                  <dt>Role</dt>
                  <dd>{role}</dd>
                </div>
              ) : null}
              {center ? (
                <div>
                  <dt>Center</dt>
                  <dd>{center}</dd>
                </div>
              ) : null}
            </dl>
          </div>
          <Menu.Separator className="menu-rule" />
          <Menu.Label className="menu-label">Corners</Menu.Label>
          <Menu.RadioGroup value={shape} onValueChange={(next) => setShape(next as ShapeId)}>
            <div className="menu-choices">
              <Menu.RadioItem className="menu-item" value="square">
                <Menu.ItemIndicator className="pick-check">
                  <Check size={14} strokeWidth={1.75} aria-hidden="true" />
                </Menu.ItemIndicator>
                Square
              </Menu.RadioItem>
              <Menu.RadioItem className="menu-item" value="round">
                <Menu.ItemIndicator className="pick-check">
                  <Check size={14} strokeWidth={1.75} aria-hidden="true" />
                </Menu.ItemIndicator>
                Round
              </Menu.RadioItem>
            </div>
          </Menu.RadioGroup>
          <Menu.Label className="menu-label">Theme</Menu.Label>
          <Menu.RadioGroup value={theme} onValueChange={(next) => setTheme(next as ThemeId)}>
            {(["light", "dark"] as const).map((tone) => (
              <div key={tone} className="menu-choices">
                <span className="menu-sub">{tone === "light" ? "Light" : "Dark"}</span>
                {themes
                  .filter((item) => item.tone === tone)
                  .map((item) => (
                    <Menu.RadioItem key={item.id} className="menu-item" value={item.id}>
                      <Menu.ItemIndicator className="pick-check">
                        <Check size={14} strokeWidth={1.75} aria-hidden="true" />
                      </Menu.ItemIndicator>
                      <span className="swatch" style={{ background: item.panel, boxShadow: `inset 0 -5px 0 ${item.accent}` }} />
                      {item.label}
                    </Menu.RadioItem>
                  ))}
              </div>
            ))}
          </Menu.RadioGroup>
          {canSignOut ? (
            <>
              <Menu.Separator className="menu-rule" />
              <Menu.Item className="menu-item" onSelect={onSignOut}>
                Sign out
              </Menu.Item>
            </>
          ) : null}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
