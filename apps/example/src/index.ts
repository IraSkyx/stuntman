import { StuntmanMock } from '@stuntman/server';
import { v4 as uuidv4 } from 'uuid';
import { stuntmanConfig } from '@stuntman/shared';
import express from 'express';
import session from 'express-session';
import dns, { LookupAddress } from 'node:dns';
// using node-fetch to override DNS resolution
// in real life you can add entries to /etc/hosts or configure DNS in your network
import nodeFetch from 'node-fetch';
import http from 'http';
import https from 'https';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// TODO collect mock server coverage

const staticLookup = (
    hostname: string,
    _options: any,
    cb: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family: number) => void
) => {
    if (/\.stuntman(https?)?$/.test(hostname)) {
        cb(null, [{ address: '127.0.0.1', family: 4 }], 4);
        return;
    }
    dns.resolve4(hostname, (err, addresses) => {
        if (!addresses?.length) {
            cb(new Error('Unable to find address'), '', 4);
            return;
        }
        cb(
            err,
            addresses.map((address) => ({ address, family: 4 })),
            4
        );
    });
};

const staticDnsAgent = (scheme: 'http' | 'https') => {
    const httpModule = scheme === 'http' ? http : https;
    return new httpModule.Agent({ lookup: staticLookup });
};

declare module 'express-session' {
    interface SessionData {
        referral?: string | undefined;
        uniqueId?: string | undefined;
    }
}

const PORT = 8080;

const exampleApp = express();

exampleApp.use(
    session({
        secret: 'fantastic cat',
        resave: false,
        saveUninitialized: true,
        cookie: { secure: false },
    })
);
exampleApp.use(express.urlencoded());
exampleApp.use(express.raw({ type: '*/*' }));
exampleApp.set('views', __dirname + '/views');
exampleApp.set('view engine', 'pug');

const postHit = async (uniqueId: string, email: string) => {
    dns.setDefaultResultOrder('ipv4first');
    try {
        const response = await nodeFetch('http://jsonplaceholder.typicode.com.stuntmanhttps:2015/posts', {
            method: 'POST',
            body: JSON.stringify({
                title: `hit - ${uniqueId}`,
                body: email,
                userId: 1,
            }),
            headers: {
                'Content-type': 'application/json; charset=UTF-8',
            },
            agent: staticDnsAgent('http'),
            timeout: 5000,
        });
        return response.json();
    } catch (error) {
        // eslint-disable-next-line no-console
        console.error(error);
        throw error;
    }
};

exampleApp.get('/', async (_req: express.Request, res) => {
    res.render('home', { uniqueId: uuidv4() });
});

exampleApp.get('/home', async (_req: express.Request, res) => {
    res.render('home', { uniqueId: uuidv4() });
});

exampleApp.get(
    '/signup',
    async (req: express.Request<null, any, { email: string }, { source?: string; uniqueId?: string }>, res) => {
        req.session.referral = req.query.source;
        req.session.uniqueId = req.query.uniqueId;
        req.session.save();
        res.render('signup');
    }
);

exampleApp.post('/signup', async (req: express.Request<null, any, { email: string }>, res) => {
    if (req.session.referral && req.session.uniqueId) {
        // letting 3rd party know user came from referral
        const hitResponse = await postHit(req.session.uniqueId, req.body.email);
        if (!/^hit/.test(hitResponse.title)) {
            // eslint-disable-next-line no-console
            console.warn('hitResponse', hitResponse);
            res.status(500).send('something went wrong');
            return;
        }
    }
    res.render('signupOk', { email: req.body.email });
});

const mock = new StuntmanMock(stuntmanConfig);
// NOTE: mock will automatically load and compile rules from ./rules directory

mock.start();

exampleApp.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`Example app listening at localhost:${PORT}`);
});
