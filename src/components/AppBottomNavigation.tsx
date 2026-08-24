import {
  IconArrowDownRightArrowUpLeftFill,
  IconArrowDownRightArrowUpLeftLine,
  IconGridHeartFill,
  IconGridHeartLine,
  IconHouseFill,
  IconHouseLine,
  IconPersonCircleFill,
  IconPersonCircleLine,
  IconShoppingbagFill,
  IconShoppingbagLine,
} from "@karrotmarket/react-monochrome-icon";
import { ROOT_TABS, type RootTabId } from "../domain/navigation";

function NavigationIcon({ id, selected }: { id: RootTabId; selected: boolean }) {
  const props = { size: 23, "aria-hidden": true } as const;

  if (id === "community") {
    return selected ? <IconArrowDownRightArrowUpLeftFill {...props} /> : <IconArrowDownRightArrowUpLeftLine {...props} />;
  }
  if (id === "shop") {
    return selected ? <IconShoppingbagFill {...props} /> : <IconShoppingbagLine {...props} />;
  }
  if (id === "home") {
    return selected ? <IconHouseFill {...props} /> : <IconHouseLine {...props} />;
  }
  if (id === "duckroom") {
    return selected ? <IconGridHeartFill {...props} /> : <IconGridHeartLine {...props} />;
  }
  return selected ? <IconPersonCircleFill {...props} /> : <IconPersonCircleLine {...props} />;
}

export function AppBottomNavigation({
  activeTab,
  onSelect,
}: {
  activeTab: RootTabId;
  onSelect: (tab: RootTabId) => void;
}) {
  return (
    <nav className="app-bottom-navigation" aria-label="주요 메뉴">
      {ROOT_TABS.map((tab) => {
        const selected = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            type="button"
            data-selected={selected ? "true" : "false"}
            aria-current={selected ? "page" : undefined}
            onClick={() => onSelect(tab.id)}
          >
            <NavigationIcon id={tab.id} selected={selected} />
            <span>{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
