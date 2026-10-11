import { paths } from '@household-brain/entries/lib/paths'
import { Redirect, Route, Switch, useLocation } from 'wouter'
import { EditItem } from './EditItem'
import { Events } from './Events'
import { Home } from './Home'
import { NewItem } from './NewItem'
import { Settings } from './Settings'
import { ToTop } from '@household-brain/shell/components/ToTop'

/**
 * The page for the current address. `/items/new` comes before `/items/:itemId`, which would match it
 * too; any other address goes to the entries. A new page starts at its top, not where the last one
 * was scrolled to.
 */
export const Pages = () => {
  const [location] = useLocation()
  return (
    <>
      <ToTop key={location} />
      <Switch>
        <Route path={paths.home} component={Home} />
        <Route path={paths.newItem} component={NewItem} />
        <Route path={paths.editItem} component={EditItem} />
        <Route path={paths.settings} component={Settings} />
        <Route path={paths.events} component={Events} />
        <Route><Redirect to={paths.home} replace /></Route>
      </Switch>
    </>
  )
}
