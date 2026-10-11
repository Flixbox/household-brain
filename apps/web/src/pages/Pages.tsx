import { paths } from '@household-brain/entries/lib/paths'
import { Redirect, Route, Switch } from 'wouter'
import { EditItem } from './EditItem'
import { Events } from './Events'
import { Home } from './Home'
import { NewItem } from './NewItem'
import { Settings } from './Settings'

/**
 * The page for the current address. `/items/new` comes before `/items/:itemId`, which would match it
 * too; any other address goes to the entries.
 */
export const Pages = () => (
  <Switch>
    <Route path={paths.home} component={Home} />
    <Route path={paths.newItem} component={NewItem} />
    <Route path={paths.editItem} component={EditItem} />
    <Route path={paths.settings} component={Settings} />
    <Route path={paths.events} component={Events} />
    <Route><Redirect to={paths.home} replace /></Route>
  </Switch>
)
