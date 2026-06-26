import type { Meta, StoryObj } from '@storybook/react';

const meta: Meta = {
  title: 'Design System/Design Tokens',
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj;

export const Colors: Story = {
  render: () => (
    <div className="p-6 space-y-6">
      <h2 className="text-2xl font-bold">Colors</h2>
      
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Primary</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 bg-primary rounded-lg"></div>
            <div>
              <p className="font-medium">Primary</p>
              <p className="text-sm text-muted-foreground">--primary</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 bg-primary-foreground rounded-lg"></div>
            <div>
              <p className="font-medium">Primary Foreground</p>
              <p className="text-sm text-muted-foreground">--primary-foreground</p>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Secondary</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 bg-secondary rounded-lg"></div>
            <div>
              <p className="font-medium">Secondary</p>
              <p className="text-sm text-muted-foreground">--secondary</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 bg-secondary-foreground rounded-lg"></div>
            <div>
              <p className="font-medium">Secondary Foreground</p>
              <p className="text-sm text-muted-foreground">--secondary-foreground</p>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Status Colors</h3>
        <div className="grid grid-cols-3 gap-4">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 bg-success rounded-lg"></div>
            <div>
              <p className="font-medium">Success</p>
              <p className="text-sm text-muted-foreground">--success</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 bg-warning rounded-lg"></div>
            <div>
              <p className="font-medium">Warning</p>
              <p className="text-sm text-muted-foreground">--warning</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 bg-destructive rounded-lg"></div>
            <div>
              <p className="font-medium">Destructive</p>
              <p className="text-sm text-muted-foreground">--destructive</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  ),
};

export const Typography: Story = {
  render: () => (
    <div className="p-6 space-y-6">
      <h2 className="text-2xl font-bold">Typography</h2>
      <div className="space-y-4">
        <p className="text-4xl font-bold">Heading 1</p>
        <p className="text-3xl font-semibold">Heading 2</p>
        <p className="text-2xl font-semibold">Heading 3</p>
        <p className="text-xl font-medium">Heading 4</p>
        <p className="text-lg">Body Large</p>
        <p className="text-base">Body</p>
        <p className="text-sm">Body Small</p>
        <p className="text-xs">Caption</p>
      </div>
    </div>
  ),
};
