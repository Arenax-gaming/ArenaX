'use client'

import React from 'react'

type Category = 'global' | 'tournaments' | 'casual'

interface CategorySelectorProps {
  category: Category
  onChange: (category: Category) => void
}

const categories: { id: Category; label: string; description: string }[] = [
  {
    id: 'global',
    label: 'Global',
    description: 'Compete with all players',
  },
  {
    id: 'tournaments',
    label: 'Tournaments',
    description: 'Tournament-only rankings',
  },
  {
    id: 'casual',
    label: 'Casual',
    description: 'Casual game rankings',
  },
]

export const CategorySelector: React.FC<CategorySelectorProps> = ({
  category,
  onChange,
}) => {
  return (
    <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
      <h3 className="text-sm font-semibold text-gray-300 mb-3">Category</h3>
      <div className="flex gap-2">
        {categories.map((cat) => (
          <button
            key={cat.id}
            onClick={() => onChange(cat.id)}
            className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${
              category === cat.id
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
            title={cat.description}
          >
            {cat.label}
          </button>
        ))}
      </div>
    </div>
  )
}
