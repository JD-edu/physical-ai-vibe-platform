/****************************************************************************
** Meta object code from reading C++ file 'bridge_server.h'
**
** Created by: The Qt Meta Object Compiler version 67 (Qt 5.15.13)
**
** WARNING! All changes made in this file will be lost!
*****************************************************************************/

#include <memory>
#include "../../../src/bridge_server.h"
#include <QtCore/qbytearray.h>
#include <QtCore/qmetatype.h>
#if !defined(Q_MOC_OUTPUT_REVISION)
#error "The header file 'bridge_server.h' doesn't include <QObject>."
#elif Q_MOC_OUTPUT_REVISION != 67
#error "This file was generated using the moc from 5.15.13. It"
#error "cannot be used with the include files from this version of Qt."
#error "(The moc has changed too much.)"
#endif

QT_BEGIN_MOC_NAMESPACE
QT_WARNING_PUSH
QT_WARNING_DISABLE_DEPRECATED
struct qt_meta_stringdata_BridgeServer_t {
    QByteArrayData data[13];
    char stringdata0[127];
};
#define QT_MOC_LITERAL(idx, ofs, len) \
    Q_STATIC_BYTE_ARRAY_DATA_HEADER_INITIALIZER_WITH_OFFSET(len, \
    qptrdiff(offsetof(qt_meta_stringdata_BridgeServer_t, stringdata0) + ofs \
        - idx * sizeof(QByteArrayData)) \
    )
static const qt_meta_stringdata_BridgeServer_t qt_meta_stringdata_BridgeServer = {
    {
QT_MOC_LITERAL(0, 0, 12), // "BridgeServer"
QT_MOC_LITERAL(1, 13, 14), // "runningChanged"
QT_MOC_LITERAL(2, 28, 0), // ""
QT_MOC_LITERAL(3, 29, 7), // "running"
QT_MOC_LITERAL(4, 37, 14), // "clientsChanged"
QT_MOC_LITERAL(5, 52, 5), // "count"
QT_MOC_LITERAL(6, 58, 6), // "packet"
QT_MOC_LITERAL(7, 65, 9), // "direction"
QT_MOC_LITERAL(8, 75, 7), // "message"
QT_MOC_LITERAL(9, 83, 12), // "stateChanged"
QT_MOC_LITERAL(10, 96, 11), // "webActivity"
QT_MOC_LITERAL(11, 108, 12), // "networkEvent"
QT_MOC_LITERAL(12, 121, 5) // "event"

    },
    "BridgeServer\0runningChanged\0\0running\0"
    "clientsChanged\0count\0packet\0direction\0"
    "message\0stateChanged\0webActivity\0"
    "networkEvent\0event"
};
#undef QT_MOC_LITERAL

static const uint qt_meta_data_BridgeServer[] = {

 // content:
       8,       // revision
       0,       // classname
       0,    0, // classinfo
       6,   14, // methods
       0,    0, // properties
       0,    0, // enums/sets
       0,    0, // constructors
       0,       // flags
       6,       // signalCount

 // signals: name, argc, parameters, tag, flags
       1,    1,   44,    2, 0x06 /* Public */,
       4,    1,   47,    2, 0x06 /* Public */,
       6,    2,   50,    2, 0x06 /* Public */,
       9,    0,   55,    2, 0x06 /* Public */,
      10,    0,   56,    2, 0x06 /* Public */,
      11,    1,   57,    2, 0x06 /* Public */,

 // signals: parameters
    QMetaType::Void, QMetaType::Bool,    3,
    QMetaType::Void, QMetaType::Int,    5,
    QMetaType::Void, QMetaType::QString, QMetaType::QString,    7,    8,
    QMetaType::Void,
    QMetaType::Void,
    QMetaType::Void, QMetaType::QJsonObject,   12,

       0        // eod
};

void BridgeServer::qt_static_metacall(QObject *_o, QMetaObject::Call _c, int _id, void **_a)
{
    if (_c == QMetaObject::InvokeMetaMethod) {
        auto *_t = static_cast<BridgeServer *>(_o);
        (void)_t;
        switch (_id) {
        case 0: _t->runningChanged((*reinterpret_cast< bool(*)>(_a[1]))); break;
        case 1: _t->clientsChanged((*reinterpret_cast< int(*)>(_a[1]))); break;
        case 2: _t->packet((*reinterpret_cast< const QString(*)>(_a[1])),(*reinterpret_cast< const QString(*)>(_a[2]))); break;
        case 3: _t->stateChanged(); break;
        case 4: _t->webActivity(); break;
        case 5: _t->networkEvent((*reinterpret_cast< const QJsonObject(*)>(_a[1]))); break;
        default: ;
        }
    } else if (_c == QMetaObject::IndexOfMethod) {
        int *result = reinterpret_cast<int *>(_a[0]);
        {
            using _t = void (BridgeServer::*)(bool );
            if (*reinterpret_cast<_t *>(_a[1]) == static_cast<_t>(&BridgeServer::runningChanged)) {
                *result = 0;
                return;
            }
        }
        {
            using _t = void (BridgeServer::*)(int );
            if (*reinterpret_cast<_t *>(_a[1]) == static_cast<_t>(&BridgeServer::clientsChanged)) {
                *result = 1;
                return;
            }
        }
        {
            using _t = void (BridgeServer::*)(const QString & , const QString & );
            if (*reinterpret_cast<_t *>(_a[1]) == static_cast<_t>(&BridgeServer::packet)) {
                *result = 2;
                return;
            }
        }
        {
            using _t = void (BridgeServer::*)();
            if (*reinterpret_cast<_t *>(_a[1]) == static_cast<_t>(&BridgeServer::stateChanged)) {
                *result = 3;
                return;
            }
        }
        {
            using _t = void (BridgeServer::*)();
            if (*reinterpret_cast<_t *>(_a[1]) == static_cast<_t>(&BridgeServer::webActivity)) {
                *result = 4;
                return;
            }
        }
        {
            using _t = void (BridgeServer::*)(const QJsonObject & );
            if (*reinterpret_cast<_t *>(_a[1]) == static_cast<_t>(&BridgeServer::networkEvent)) {
                *result = 5;
                return;
            }
        }
    }
}

QT_INIT_METAOBJECT const QMetaObject BridgeServer::staticMetaObject = { {
    QMetaObject::SuperData::link<QObject::staticMetaObject>(),
    qt_meta_stringdata_BridgeServer.data,
    qt_meta_data_BridgeServer,
    qt_static_metacall,
    nullptr,
    nullptr
} };


const QMetaObject *BridgeServer::metaObject() const
{
    return QObject::d_ptr->metaObject ? QObject::d_ptr->dynamicMetaObject() : &staticMetaObject;
}

void *BridgeServer::qt_metacast(const char *_clname)
{
    if (!_clname) return nullptr;
    if (!strcmp(_clname, qt_meta_stringdata_BridgeServer.stringdata0))
        return static_cast<void*>(this);
    return QObject::qt_metacast(_clname);
}

int BridgeServer::qt_metacall(QMetaObject::Call _c, int _id, void **_a)
{
    _id = QObject::qt_metacall(_c, _id, _a);
    if (_id < 0)
        return _id;
    if (_c == QMetaObject::InvokeMetaMethod) {
        if (_id < 6)
            qt_static_metacall(this, _c, _id, _a);
        _id -= 6;
    } else if (_c == QMetaObject::RegisterMethodArgumentMetaType) {
        if (_id < 6)
            *reinterpret_cast<int*>(_a[0]) = -1;
        _id -= 6;
    }
    return _id;
}

// SIGNAL 0
void BridgeServer::runningChanged(bool _t1)
{
    void *_a[] = { nullptr, const_cast<void*>(reinterpret_cast<const void*>(std::addressof(_t1))) };
    QMetaObject::activate(this, &staticMetaObject, 0, _a);
}

// SIGNAL 1
void BridgeServer::clientsChanged(int _t1)
{
    void *_a[] = { nullptr, const_cast<void*>(reinterpret_cast<const void*>(std::addressof(_t1))) };
    QMetaObject::activate(this, &staticMetaObject, 1, _a);
}

// SIGNAL 2
void BridgeServer::packet(const QString & _t1, const QString & _t2)
{
    void *_a[] = { nullptr, const_cast<void*>(reinterpret_cast<const void*>(std::addressof(_t1))), const_cast<void*>(reinterpret_cast<const void*>(std::addressof(_t2))) };
    QMetaObject::activate(this, &staticMetaObject, 2, _a);
}

// SIGNAL 3
void BridgeServer::stateChanged()
{
    QMetaObject::activate(this, &staticMetaObject, 3, nullptr);
}

// SIGNAL 4
void BridgeServer::webActivity()
{
    QMetaObject::activate(this, &staticMetaObject, 4, nullptr);
}

// SIGNAL 5
void BridgeServer::networkEvent(const QJsonObject & _t1)
{
    void *_a[] = { nullptr, const_cast<void*>(reinterpret_cast<const void*>(std::addressof(_t1))) };
    QMetaObject::activate(this, &staticMetaObject, 5, _a);
}
QT_WARNING_POP
QT_END_MOC_NAMESPACE
