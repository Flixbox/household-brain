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
    <Route path="/" component={Home} />
    <Route path="/items/new" component={NewItem} />
    <Route path="/items/:itemId" component={EditItem} />
    <Route path="/settings" component={Settings} />
    <Route path="/events" component={Events} />
    <Route><Redirect to="/" replace /></Route>
  </Switch>
)
