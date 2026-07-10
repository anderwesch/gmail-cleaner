'use client'

type Location = 'all' | 'inbox' | 'archived'

interface LocationTabsProps {
  activeLocation: Location
  onChange: (location: Location) => void
}

const TABS: { key: Location; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'inbox', label: 'Inbox' },
  { key: 'archived', label: 'Archived' },
]

export function LocationTabs({ activeLocation, onChange }: LocationTabsProps) {
  return (
    <div className="flex gap-1">
      {TABS.map(tab => (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            activeLocation === tab.key
              ? 'bg-gray-900 text-white'
              : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
