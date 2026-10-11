import { SettingsSections } from '@household-brain/entries/components/settings/SettingsSections'
import { Link } from 'wouter'
import { paths } from '@household-brain/entries/lib/paths'

export const Settings = () => (
  <section className="space-y-8">
    <div className="flex items-baseline justify-between">
      <h1 className="text-3xl font-bold">Settings</h1>
      <Link href={paths.home} className="text-orange-700 underline dark:text-orange-400">Back</Link>
    </div>
    <SettingsSections />
  </section>
)
